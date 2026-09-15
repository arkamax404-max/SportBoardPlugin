"use strict";

const { createHash } = require("node:crypto");

// football-data.org boundary. Match retrieval is team-scoped and bounded around
// the current instant so one request contains both the latest finished fixture and
// the next scheduled fixture; presentation chooses whichever kickoff is nearest.

const DEFAULT_COMPETITION = "PD";
const BASE_URL = "https://api.football-data.org/v4";
const MATCH_WINDOW_DAYS = 365;
const MATCH_LIMIT = 100;
const MAX_CREST_BYTES = 256 * 1024;
const CREST_HOST = "crests.football-data.org";
const CREST_TYPES = new Set(["image/png", "image/svg+xml", "image/jpeg", "image/webp"]);

function requireToken(token) {
  if (typeof token !== "string" || token.trim().length === 0) throw new TypeError("football-data token is required");
  return token.trim();
}

function requireCompetition(competition) {
  if (typeof competition !== "string" || !/^[A-Z]{2,4}$/.test(competition.trim())) {
    throw new TypeError("competition code is required");
  }
  return competition.trim();
}

function requireTeamId(teamId) {
  if (!Number.isInteger(teamId) || teamId <= 0) throw new TypeError("team id must be a positive integer");
  return teamId;
}

function requireMatchId(matchId) {
  if (typeof matchId !== "string" || !/^[1-9][0-9]*$/.test(matchId)) {
    throw new TypeError("match id must be a positive integer string");
  }
  const id = Number(matchId);
  if (!Number.isSafeInteger(id)) throw new TypeError("match id must be a positive integer string");
  return matchId;
}

function requireReference(reference) {
  if (!(reference instanceof Date) || Number.isNaN(reference.getTime())) throw new TypeError("reference instant must be a valid Date");
  return reference;
}

function shiftUtcDate(reference, days) {
  const date = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function teamLabel(team) {
  if (!team || typeof team !== "object") return null;
  if (typeof team.shortName === "string" && team.shortName.length > 0) return team.shortName;
  return typeof team.name === "string" && team.name.length > 0 ? team.name : null;
}

function crestUrl(team) {
  return typeof team?.crest === "string" && team.crest.length > 0 ? team.crest : null;
}

function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeMatch(match, competition) {
  if (!match || typeof match !== "object") throw new TypeError("match must be an object");
  const kickoff = typeof match.utcDate === "string" && !Number.isNaN(Date.parse(match.utcDate)) ? match.utcDate : null;
  return Object.freeze({
    id: String(match.id),
    leagueId: competition,
    round: match.matchday == null ? null : String(match.matchday),
    homeTeamId: match.homeTeam?.id ?? null,
    awayTeamId: match.awayTeam?.id ?? null,
    homeTeam: teamLabel(match.homeTeam),
    awayTeam: teamLabel(match.awayTeam),
    homeCrestUrl: crestUrl(match.homeTeam),
    awayCrestUrl: crestUrl(match.awayTeam),
    homeScore: match.score?.fullTime?.home ?? null,
    awayScore: match.score?.fullTime?.away ?? null,
    status: match.status ?? null,
    progress: null,
    minute: nonNegativeInteger(match.minute),
    injuryTime: nonNegativeInteger(match.injuryTime),
    kickoff,
    date: kickoff?.slice(0, 10) ?? null,
    time: kickoff?.slice(11, 19) ?? null,
  });
}

class FootballDataScoreProvider {
  #requester;
  #crestPromises = new Map();
  #matchDetailPromises = new Map();

  constructor({ fetch } = {}) {
    if (typeof fetch !== "function") throw new TypeError("fetch must be a function");
    this.#requester = fetch;
  }

  async listMatches(teamId, token, competition, reference) {
    const id = requireTeamId(teamId);
    const auth = requireToken(token);
    const code = requireCompetition(competition);
    const now = requireReference(reference);
    const query = new URLSearchParams({
      dateFrom: shiftUtcDate(now, -MATCH_WINDOW_DAYS),
      dateTo: shiftUtcDate(now, MATCH_WINDOW_DAYS),
      competitions: code,
      limit: String(MATCH_LIMIT),
    });
    const payload = await this.#request(`/teams/${id}/matches?${query.toString()}`, auth);
    if (!Array.isArray(payload.matches)) throw new TypeError("football-data payload is malformed");
    return payload.matches.map((match) => normalizeMatch(match, code));
  }

  async loadMatchDetail(matchId, token, competition) {
    const id = requireMatchId(matchId);
    const auth = requireToken(token);
    const code = requireCompetition(competition);
    const tokenIdentity = createHash("sha256").update(auth).digest("hex");
    const key = `${id}:${tokenIdentity}`;
    let pending = this.#matchDetailPromises.get(key);
    if (!pending) {
      pending = this.#request(`/matches/${id}`, auth).then(
        (payload) => {
          if (this.#matchDetailPromises.get(key) === pending) this.#matchDetailPromises.delete(key);
          return payload;
        },
        (error) => {
          if (this.#matchDetailPromises.get(key) === pending) this.#matchDetailPromises.delete(key);
          throw error;
        },
      );
      this.#matchDetailPromises.set(key, pending);
    }
    return normalizeMatch(await pending, code);
  }

  // Crest URLs are public, but only the provider's dedicated HTTPS host is allowed.
  // Successful downloads stay in memory for the process lifetime, including every
  // two-minute live refresh; a failed promise is removed so a later manual refresh
  // can retry. The byte and MIME bounds keep an API payload from becoming an
  // unbounded image allocation.
  loadCrest(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return Promise.reject(new TypeError("crest URL is invalid"));
    }
    if (url.protocol !== "https:" || url.hostname !== CREST_HOST) {
      return Promise.reject(new TypeError("crest URL is not allowlisted"));
    }
    if (this.#crestPromises.has(url.href)) return this.#crestPromises.get(url.href);
    const pending = this.#downloadCrest(url.href).catch((error) => {
      this.#crestPromises.delete(url.href);
      throw error;
    });
    this.#crestPromises.set(url.href, pending);
    return pending;
  }

  async #downloadCrest(url) {
    let response;
    try {
      // Never follow a redirect: validating response.url afterwards would be too
      // late because fetch would already have contacted the redirected host.
      response = await this.#requester(url, { redirect: "error" });
    } catch (error) {
      throw new Error("crest request failed", { cause: error });
    }
    if (!response?.ok || typeof response.arrayBuffer !== "function") throw new Error("crest request failed");
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.protocol !== "https:" || finalUrl.hostname !== CREST_HOST) throw new TypeError("crest URL is not allowlisted");
    }
    const type = response.headers?.get?.("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!CREST_TYPES.has(type)) throw new TypeError("crest content type is unsupported");
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CREST_BYTES) {
      throw new RangeError("crest image is outside the size limit");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_CREST_BYTES) throw new RangeError("crest image is outside the size limit");
    return `data:${type};base64,${bytes.toString("base64")}`;
  }

  async listCompetitions(token) {
    const payload = await this.#request("/competitions", requireToken(token));
    if (!Array.isArray(payload.competitions)) throw new TypeError("football-data payload is malformed");
    return payload.competitions
      .filter((competition) => competition && competition.type === "LEAGUE" && typeof competition.code === "string")
      .map((competition) => ({ code: competition.code, name: competition.name ?? competition.code }));
  }

  async listTeams(token, competition) {
    const code = requireCompetition(competition);
    const payload = await this.#request(`/competitions/${code}/teams`, requireToken(token));
    if (!Array.isArray(payload.teams)) throw new TypeError("football-data payload is malformed");
    return payload.teams
      .filter((team) => team && typeof team.id === "number")
      .map((team) => ({ id: team.id, name: teamLabel(team) }));
  }

  async #request(path, token) {
    let response;
    try {
      response = await this.#requester(`${BASE_URL}${path}`, { headers: { "X-Auth-Token": token } });
    } catch (error) {
      throw new Error("football-data request failed", { cause: error });
    }
    if (!response || typeof response.ok !== "boolean") throw new TypeError("football-data response is malformed");
    if (!response.ok) throw new Error(`football-data request failed with HTTP ${String(response.status)}`);
    try {
      const payload = await response.json();
      if (!payload || typeof payload !== "object") throw new TypeError("football-data payload is malformed");
      return payload;
    } catch (error) {
      throw new TypeError("football-data payload is malformed", { cause: error });
    }
  }
}

class ScoreService {
  #provider;

  constructor({ provider } = {}) {
    if (!provider || typeof provider !== "object") throw new TypeError("provider must implement listMatches");
    for (const method of ["listMatches", "listCompetitions", "listTeams"]) {
      if (typeof provider[method] !== "function") throw new TypeError(`provider must implement ${method}`);
    }
    this.#provider = provider;
  }

  listMatches(teamId, token, competition, reference) {
    return this.#provider.listMatches(teamId, token, competition, reference);
  }

  loadMatchDetail(matchId, token, competition) {
    return typeof this.#provider.loadMatchDetail === "function"
      ? this.#provider.loadMatchDetail(matchId, token, competition)
      : Promise.resolve(null);
  }

  loadCrest(url) {
    return typeof this.#provider.loadCrest === "function" ? this.#provider.loadCrest(url) : Promise.resolve(null);
  }

  listCompetitions(token) { return this.#provider.listCompetitions(token); }
  listTeams(token, competition) { return this.#provider.listTeams(token, competition); }
}

module.exports = {
  DEFAULT_COMPETITION,
  FootballDataScoreProvider,
  MATCH_LIMIT,
  MATCH_WINDOW_DAYS,
  ScoreService,
};
