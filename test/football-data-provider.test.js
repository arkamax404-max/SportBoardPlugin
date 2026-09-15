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
    status: "FINISHED", progress: null, minute: null, injuryTime: null,
    kickoff: "2026-09-04T19:00:00Z",
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

test("normalizes match clock values as non-negative integers", async () => {
  const matches = [
    { ...BETIS_MATCH, id: 1, minute: 0, injuryTime: 0 },
    { ...BETIS_MATCH, id: 2, minute: 45, injuryTime: 2 },
    { ...BETIS_MATCH, id: 3, minute: "46", injuryTime: -1 },
    { ...BETIS_MATCH, id: 4, minute: Number.NaN, injuryTime: 1.5 },
    { ...BETIS_MATCH, id: 5 },
  ];
  const provider = new FootballDataScoreProvider({ fetch: async () => response({ matches }) });

  const result = await provider.listMatches(90, "t", "PD", new Date("2026-09-14T00:00:00Z"));

  assert.deepEqual(result.map(({ minute, injuryTime }) => ({ minute, injuryTime })), [
    { minute: 0, injuryTime: 0 },
    { minute: 45, injuryTime: 2 },
    { minute: null, injuryTime: null },
    { minute: null, injuryTime: null },
    { minute: null, injuryTime: null },
  ]);
});

test("loads one normalized match detail through the authenticated match path", async () => {
  const calls = [];
  const detail = { ...BETIS_MATCH, status: "IN_PLAY", minute: 45, injuryTime: 3 };
  const provider = new FootballDataScoreProvider({ fetch: async (url, options) => {
    calls.push({ url, options });
    return response(detail);
  } });

  const result = await provider.loadMatchDetail("123456", "detail-secret", "PD");

  assert.equal(calls[0].url, "https://api.football-data.org/v4/matches/123456");
  assert.deepEqual(calls[0].options, { headers: { "X-Auth-Token": "detail-secret" } });
  assert.equal(calls[0].url.includes("detail-secret"), false);
  assert.equal(result.id, "123456");
  assert.equal(result.minute, 45);
  assert.equal(result.injuryTime, 3);
  assert.ok(Object.isFrozen(result));
});

test("rejects malformed match detail IDs before constructing a request path", async () => {
  let called = 0;
  const provider = new FootballDataScoreProvider({ fetch: async () => {
    called += 1;
    return response(BETIS_MATCH);
  } });

  for (const id of [123456, "", "0", "-1", "1.5", "01", "1/../teams", "1?token=secret", "9007199254740992"]) {
    await assert.rejects(() => provider.loadMatchDetail(id, "t", "PD"), /match id/);
  }
  assert.equal(called, 0);
});

test("deduplicates concurrent match details and retries after a failed request", async () => {
  let calls = 0;
  let release;
  const firstResponse = new Promise((resolve) => { release = resolve; });
  const provider = new FootballDataScoreProvider({ fetch: async () => {
    calls += 1;
    if (calls === 1) return firstResponse;
    if (calls === 2) throw new Error("temporary outage");
    return response({ ...BETIS_MATCH, minute: 47, injuryTime: 0 });
  } });

  const first = provider.loadMatchDetail("123456", "same-token", "PD");
  const concurrent = provider.loadMatchDetail("123456", "same-token", "PD");
  assert.equal(calls, 1);
  release(response({ ...BETIS_MATCH, minute: 46, injuryTime: 1 }));
  assert.deepEqual((await Promise.all([first, concurrent])).map(({ minute }) => minute), [46, 46]);

  await assert.rejects(() => provider.loadMatchDetail("123456", "same-token", "PD"), /request failed/);
  const retried = await provider.loadMatchDetail("123456", "same-token", "PD");
  assert.equal(retried.minute, 47);
  assert.equal(calls, 3);
});

test("keeps concurrent match-detail requests isolated across tokens", async () => {
  const calls = [];
  const releases = [];
  const provider = new FootballDataScoreProvider({ fetch: async (url, options) => {
    calls.push({ url, token: options.headers["X-Auth-Token"] });
    return new Promise((resolve) => releases.push(resolve));
  } });

  const first = provider.loadMatchDetail("123456", "token-a", "PD");
  const second = provider.loadMatchDetail("123456", "token-b", "PD");
  assert.deepEqual(calls, [
    { url: "https://api.football-data.org/v4/matches/123456", token: "token-a" },
    { url: "https://api.football-data.org/v4/matches/123456", token: "token-b" },
  ]);

  releases[0](response({ ...BETIS_MATCH, minute: 40 }));
  releases[1](response({ ...BETIS_MATCH, minute: 41 }));
  assert.deepEqual((await Promise.all([first, second])).map(({ minute }) => minute), [40, 41]);
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
