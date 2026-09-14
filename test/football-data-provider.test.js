"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { FootballDataScoreProvider } = require("../src/plugin/score-service.js");

const BETIS_MATCH = {
  id: 123456, utcDate: "2026-09-04T19:00:00Z", status: "FINISHED", matchday: 4,
  homeTeam: { id: 90, name: "Real Betis Balompié", shortName: "Real Betis", crest: "https://crests.football-data.org/90.png" },
  awayTeam: { id: 86, name: "Real Madrid CF", shortName: "Real Madrid", crest: "https://crests.football-data.org/86.svg" },
  score: { fullTime: { home: 1, away: 0 } },
};

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test("queries one bounded team match window with explicit competition and limit", async () => {
  const calls = [];
  const provider = new FootballDataScoreProvider({ fetch: async (url, options) => {
    calls.push({ url, options });
    return response({ matches: [BETIS_MATCH] });
  } });
  const now = new Date("2026-09-14T18:00:00Z");
  const result = await provider.listMatches(90, "secret-token", "PD", now);
  assert.equal(calls[0].url, "https://api.football-data.org/v4/teams/90/matches?dateFrom=2025-09-14&dateTo=2027-09-14&competitions=PD&limit=100");
  assert.equal(calls[0].options.headers["X-Auth-Token"], "secret-token");
  assert.deepEqual(result, [{
    id: "123456", leagueId: "PD", round: "4", homeTeamId: 90, awayTeamId: 86,
    homeTeam: "Real Betis", awayTeam: "Real Madrid",
    homeCrestUrl: "https://crests.football-data.org/90.png",
    awayCrestUrl: "https://crests.football-data.org/86.svg",
    homeScore: 1, awayScore: 0,
    status: "FINISHED", progress: null, kickoff: "2026-09-04T19:00:00Z",
    date: "2026-09-04", time: "19:00:00",
  }]);
  assert.ok(Object.isFrozen(result[0]));
});

test("validates team, token, competition and reference instant before requesting", async () => {
  let called = 0;
  const provider = new FootballDataScoreProvider({ fetch: async () => { called += 1; return response({ matches: [] }); } });
  await assert.rejects(() => provider.listMatches("90", "t", "PD", new Date()), /team id/);
  await assert.rejects(() => provider.listMatches(90, " ", "PD", new Date()), /token/);
  await assert.rejects(() => provider.listMatches(90, "t", "", new Date()), /competition/);
  await assert.rejects(() => provider.listMatches(90, "t", "PD", new Date("invalid")), /reference/);
  assert.equal(called, 0);
});

test("normalizes labels and rejects malformed match payloads", async () => {
  const provider = new FootballDataScoreProvider({ fetch: async () => response({ matches: [{ ...BETIS_MATCH, homeTeam: { id: 90, name: "Real Betis Balompié" } }] }) });
  const [match] = await provider.listMatches(90, "t", "PD", new Date("2026-09-14T00:00:00Z"));
  assert.equal(match.homeTeam, "Real Betis Balompié");
  assert.equal(match.kickoff, BETIS_MATCH.utcDate);

  const malformed = new FootballDataScoreProvider({ fetch: async () => response({ nope: [] }) });
  await assert.rejects(() => malformed.listMatches(90, "t", "PD", new Date()), /malformed/);
});

test("downloads an allowlisted crest once without following redirects", async () => {
  const calls = [];
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const provider = new FootballDataScoreProvider({ fetch: async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === "content-type" ? "image/png" : null },
      arrayBuffer: async () => bytes,
    };
  } });
  const url = "https://crests.football-data.org/90.png";
  const first = await provider.loadCrest(url);
  const second = await provider.loadCrest(url);
  assert.equal(first, `data:image/png;base64,${bytes.toString("base64")}`);
  assert.equal(second, first);
  assert.deepEqual(calls, [{ url, options: { redirect: "error" } }]);
  await assert.rejects(() => provider.loadCrest("https://example.com/90.png"), /crest URL/);
});

test("rejects an oversized declared crest before reading its body", async () => {
  let bodyReads = 0;
  const provider = new FootballDataScoreProvider({ fetch: async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => ({ "content-type": "image/png", "content-length": String(300 * 1024) })[name.toLowerCase()] ?? null },
    arrayBuffer: async () => { bodyReads += 1; return Buffer.alloc(300 * 1024); },
  }) });
  await assert.rejects(() => provider.loadCrest("https://crests.football-data.org/90.png"), /size limit/);
  assert.equal(bodyReads, 0);
});

test("lists accessible league competitions and competition teams", async () => {
  const calls = [];
  const provider = new FootballDataScoreProvider({ fetch: async (url) => {
    calls.push(url);
    if (url.endsWith("/competitions")) return response({ competitions: [
      { code: "PD", name: "Primera Division", type: "LEAGUE" },
      { code: "CL", name: "Champions League", type: "CUP" },
    ] });
    return response({ teams: [{ id: 86, name: "Real Madrid CF", shortName: "Real Madrid" }] });
  } });
  assert.deepEqual(await provider.listCompetitions("t"), [{ code: "PD", name: "Primera Division" }]);
  assert.deepEqual(await provider.listTeams("t", "PD"), [{ id: 86, name: "Real Madrid" }]);
  assert.ok(calls[1].endsWith("/competitions/PD/teams"));
});
