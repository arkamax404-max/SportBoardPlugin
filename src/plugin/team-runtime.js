"use strict";

// Per-key view for one configured team. It selects the fixture nearest to now and
// owns a single one-shot poll timer per key context. Polling exists only on the
// match's local calendar day while the provider still reports a non-terminal state.

const { createScoreImage } = require("./score-image.js");

const DEFAULT_COMPETITION = "PD";
const DEFAULT_TEAM_ID = 90;
const DEFAULT_TEAM_LABEL = "Betis";
const POLL_INTERVAL_MS = 120000;
const TERMINAL_STATUSES = new Set(["FINISHED", "CANCELLED", "POSTPONED", "SUSPENDED", "AWARDED"]);
const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED", "LIVE"]);

function toTeamId(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) return Number(value.trim());
  return DEFAULT_TEAM_ID;
}

function isTeamMatch(event, teamId) {
  return Boolean(event) && (event.homeTeamId === teamId || event.awayTeamId === teamId);
}

function kickoffTime(event) {
  const value = Date.parse(event?.kickoff);
  return Number.isNaN(value) ? null : value;
}

function formatLocalKickoffTime(event) {
  const time = kickoffTime(event);
  if (time !== null) {
    const kickoff = new Date(time);
    return `${String(kickoff.getHours()).padStart(2, "0")}:${String(kickoff.getMinutes()).padStart(2, "0")}`;
  }

  return typeof event?.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(event.time)
    ? event.time.slice(0, 5)
    : null;
}

function selectNearestMatch(matches, reference, teamId) {
  if (!Array.isArray(matches) || !(reference instanceof Date) || Number.isNaN(reference.getTime())) return null;
  const now = reference.getTime();
  let selected = null;
  let selectedTime = null;
  for (const match of matches) {
    if (!isTeamMatch(match, teamId)) continue;
    const time = kickoffTime(match);
    if (time === null) continue;
    if (selected === null) {
      selected = match;
      selectedTime = time;
      continue;
    }
    const distance = Math.abs(time - now);
    const selectedDistance = Math.abs(selectedTime - now);
    if (distance < selectedDistance || (distance === selectedDistance && time >= now && selectedTime < now)) {
      selected = match;
      selectedTime = time;
    }
  }
  return selected;
}

function sameLocalCalendarDate(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function shouldPoll(match, reference) {
  const time = kickoffTime(match);
  if (time === null || !(reference instanceof Date) || Number.isNaN(reference.getTime())) return false;
  const status = typeof match.status === "string" ? match.status.toUpperCase() : "";
  return !TERMINAL_STATUSES.has(status) && sameLocalCalendarDate(new Date(time), reference);
}

function isLiveMatch(match) {
  const status = typeof match?.status === "string" ? match.status.toUpperCase() : "";
  return LIVE_STATUSES.has(status);
}

function scoreOf(match) {
  if (match?.homeScore == null && match?.awayScore == null) return { home: 0, away: 0 };
  if (!Number.isFinite(match?.homeScore) || !Number.isFinite(match?.awayScore)) return null;
  return { home: match.homeScore, away: match.awayScore };
}

function selectionOf(param) {
  const competition = typeof param?.competition === "string" && param.competition.trim().length > 0
    ? param.competition.trim()
    : DEFAULT_COMPETITION;
  return `${competition}\u0000${toTeamId(param?.teamId)}`;
}

function formatLocalMatchDate(event) {
  const time = kickoffTime(event);
  if (time !== null) return new Date(time).toLocaleDateString();

  const parts = typeof event?.date === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(event.date)
    : null;
  if (!parts) return null;
  const fallback = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const isSameDate = fallback.getFullYear() === Number(parts[1])
    && fallback.getMonth() === Number(parts[2]) - 1
    && fallback.getDate() === Number(parts[3]);
  return isSameDate ? fallback.toLocaleDateString() : null;
}

function contextualMatchDate(event, reference) {
  const time = kickoffTime(event);
  if (time === null || !(reference instanceof Date) || Number.isNaN(reference.getTime())) {
    return formatLocalMatchDate(event);
  }
  if (!sameLocalCalendarDate(new Date(time), reference)) return formatLocalMatchDate(event);

  const status = typeof event?.status === "string" ? event.status.toUpperCase() : "";
  if (status === "SCHEDULED" || status === "TIMED") return "STARTING SOON";
  if (LIVE_STATUSES.has(status)) return "LIVE";
  if (status === "FINISHED") return "FINISHED";
  return formatLocalMatchDate(event);
}

function renderMatch(event, reference) {
  const hasScore = event.homeScore !== null && event.homeScore !== undefined
    && event.awayScore !== null && event.awayScore !== undefined;
  const result = hasScore ? `${event.homeScore} - ${event.awayScore}` : formatLocalKickoffTime(event) ?? "-";
  const lines = [event.homeTeam ?? "Home", event.awayTeam ?? "Away", result];
  const date = contextualMatchDate(event, reference);
  if (date) lines.push(date);
  return lines.join("\n");
}

class TeamRuntime {
  #host;
  #service;
  #render;
  #now;
  #setTimeout;
  #clearTimeout;
  #alert;
  #contexts = new Map();

  constructor({
    host,
    service,
    render = createScoreImage,
    now = () => new Date(),
    setTimeout = globalThis.setTimeout,
    clearTimeout = globalThis.clearTimeout,
    alert = () => {},
  } = {}) {
    if (!host || typeof host.setBaseDataIcon !== "function") throw new TypeError("host must implement setBaseDataIcon");
    if (!service || typeof service.listMatches !== "function") throw new TypeError("service must implement listMatches");
    if (typeof render !== "function" || typeof now !== "function" || typeof setTimeout !== "function" || typeof clearTimeout !== "function" || typeof alert !== "function") {
      throw new TypeError("render, alert, clock and timers must be functions");
    }
    this.#host = host;
    this.#service = service;
    this.#render = render;
    this.#now = now;
    this.#setTimeout = setTimeout;
    this.#clearTimeout = clearTimeout;
    this.#alert = alert;
  }

  #draw(context, text, options) {
    const image = this.#render(text, options);
    if (image !== null) this.#host.setBaseDataIcon(context, image);
  }

  #replaceContext(context, param) {
    const prior = this.#contexts.get(context);
    if (prior?.timer !== null && prior?.timer !== undefined) this.#clearTimeout(prior.timer);
    const selection = selectionOf(param);
    const baseline = prior?.selection === selection ? prior.baseline : null;
    const entry = { generation: (prior?.generation ?? 0) + 1, timer: null, param, selection, baseline };
    this.#contexts.set(context, entry);
    return entry;
  }

  #isCurrent(context, entry) {
    return this.#contexts.get(context) === entry;
  }

  #observeScore(entry, match) {
    const matchId = typeof match?.id === "string" || typeof match?.id === "number" ? String(match.id) : null;
    const score = scoreOf(match);
    if (matchId === null) {
      entry.baseline = null;
      return;
    }
    const prior = entry.baseline;
    entry.baseline = { matchId, score };
    if (score === null || prior === null || prior.matchId !== matchId || prior.score === null) return;
    if (prior.score.home === score.home && prior.score.away === score.away) return;
    if (!isLiveMatch(match)) return;
    try {
      const result = this.#alert();
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {
      // Audio is best-effort and must never break rendering or future polling.
    }
  }

  async refresh({ context, param } = {}, { mode = "foreground" } = {}) {
    const entry = this.#replaceContext(context, param);
    const token = param?.token;
    const label = typeof param?.teamLabel === "string" && param.teamLabel.length > 0 ? param.teamLabel : DEFAULT_TEAM_LABEL;
    if (typeof token !== "string" || token.trim().length === 0) {
      entry.baseline = null;
      this.#draw(context, `${label}\nAdd token`);
      return;
    }

    const reference = this.#now();
    if (mode === "foreground") this.#draw(context, `${label}\nLoading…`);
    try {
      const teamId = toTeamId(param?.teamId);
      const competition = typeof param?.competition === "string" && param.competition.trim().length > 0
        ? param.competition.trim()
        : DEFAULT_COMPETITION;
      const matches = await this.#service.listMatches(teamId, token, competition, reference);
      if (!this.#isCurrent(context, entry)) return;
      const match = selectNearestMatch(matches, reference, teamId);
      if (!match) {
        entry.baseline = null;
        this.#draw(context, `${label}\nNo match`);
        return;
      }
      const loadCrest = typeof this.#service.loadCrest === "function"
        ? (url) => url ? this.#service.loadCrest(url).catch(() => null) : Promise.resolve(null)
        : () => Promise.resolve(null);
      const [homeCrest, awayCrest] = await Promise.all([
        loadCrest(match.homeCrestUrl),
        loadCrest(match.awayCrestUrl),
      ]);
      if (!this.#isCurrent(context, entry)) return;
      this.#observeScore(entry, match);
      this.#draw(context, renderMatch(match, reference), { homeCrest, awayCrest, live: isLiveMatch(match) });
      if (shouldPoll(match, reference)) {
        entry.timer = this.#setTimeout(() => {
          if (!this.#isCurrent(context, entry)) return undefined;
          return this.refresh({ context, param: entry.param }, { mode: "background" });
        }, POLL_INTERVAL_MS);
      }
    } catch {
      if (this.#isCurrent(context, entry)) this.#draw(context, `${label}\nData unavailable`);
    }
  }

  clear(message) {
    const items = message && Array.isArray(message.param) ? message.param : [];
    for (const item of items) {
      const context = item?.context;
      const entry = this.#contexts.get(context);
      if (entry?.timer !== null && entry?.timer !== undefined) this.#clearTimeout(entry.timer);
      this.#contexts.delete(context);
    }
  }

  dispose() {
    for (const entry of this.#contexts.values()) {
      if (entry.timer !== null && entry.timer !== undefined) this.#clearTimeout(entry.timer);
    }
    this.#contexts.clear();
  }
}

module.exports = {
  DEFAULT_COMPETITION,
  DEFAULT_TEAM_ID,
  DEFAULT_TEAM_LABEL,
  POLL_INTERVAL_MS,
  TeamRuntime,
  formatLocalKickoffTime,
  formatLocalMatchDate,
  isLiveMatch,
  isTeamMatch,
  renderMatch,
  selectNearestMatch,
  shouldPoll,
  toTeamId,
};
