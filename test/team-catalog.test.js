"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { TeamCatalog } = require("../src/plugin/team-catalog.js");

const teams = [{ id: 90, name: "Real Betis" }, { id: 86, name: "Real Madrid" }];
const competitions = [{ code: "PD", name: "Primera Division" }, { code: "PL", name: "Premier League" }];

function fakeCache(initial = {}) {
  const store = { ...initial };
  return {
    store,
    loadCompetitions: (token) => store[`competitions:${token}`] ?? null,
    loadTeams: (token, competition) => store[`teams:${token}:${competition}`] ?? null,
    saveCompetitions: (token, competitions) => { store[`competitions:${token}`] = competitions; },
    saveTeams: (token, competition, teams) => { store[`teams:${token}:${competition}`] = teams; },
  };
}

function harness(overrides = {}) {
  const pushed = [];
  const requested = [];
  const competitionsRequested = [];
  const catalog = new TeamCatalog({
    service: {
      listCompetitions: async (token) => {
        competitionsRequested.push(token);
        if (overrides.fail) throw new Error("provider rejected the token");
        return competitions;
      },
      listTeams: async (token, competition) => {
        requested.push(`${token}|${competition}`);
        if (overrides.fail) throw new Error("provider rejected the token");
        return teams;
      },
    },
    host: { sendToPropertyInspector: (context, payload) => pushed.push({ context, payload }) },
    cache: overrides.cache,
  });
  return { catalog, pushed, requested, competitionsRequested };
}

test("publishes the competitions once per token and the teams once per competition", async () => {
  const { catalog, pushed, requested, competitionsRequested } = harness();
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD" } });
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD" } });
  assert.deepEqual(competitionsRequested, ["abc"], "an unchanged token must not refetch competitions");
  assert.deepEqual(requested, ["abc|PD"], "an unchanged token and competition must not refetch teams");
  assert.deepEqual(pushed[0].payload.competitions, [{ code: "PD", name: "Primera Division" }, { code: "PL", name: "Premier League" }]);
  assert.deepEqual(pushed[1].payload.teams, [{ id: 90, name: "Real Betis" }, { id: 86, name: "Real Madrid" }]);

  // Changing the competition must reload the team list, even with the same token.
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PL" } });
  assert.deepEqual(requested, ["abc|PD", "abc|PL"]);
  assert.deepEqual(competitionsRequested, ["abc"]);
  await catalog.publish({ context: "ctx", param: { token: "other", competition: "PL" } });
  assert.deepEqual(requested, ["abc|PD", "abc|PL", "other|PL"]);
});

test("sync republishes warm in-memory lists without refetching", async () => {
  const { catalog, pushed, requested, competitionsRequested } = harness();
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD" } });
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD", sync: true } });
  assert.deepEqual(competitionsRequested, ["abc"]);
  assert.deepEqual(requested, ["abc|PD"]);
  assert.deepEqual(pushed.slice(-2).map((item) => item.payload), [
    { competitions },
    { teams, competition: "PD" },
  ]);
});

test("concurrent startup and Inspector sync coalesce provider requests", async () => {
  let releaseCompetitions;
  let releaseTeams;
  const competitionsReady = new Promise((resolve) => { releaseCompetitions = () => resolve(competitions); });
  const teamsReady = new Promise((resolve) => { releaseTeams = () => resolve(teams); });
  const pushed = [];
  let competitionCalls = 0;
  let teamCalls = 0;
  const catalog = new TeamCatalog({
    service: {
      listCompetitions: async () => { competitionCalls += 1; return competitionsReady; },
      listTeams: async () => { teamCalls += 1; return teamsReady; },
    },
    host: { sendToPropertyInspector: (context, payload) => pushed.push({ context, payload }) },
  });
  const startup = catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD" } });
  const sync = catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD", sync: true } });
  releaseCompetitions();
  await Promise.resolve();
  releaseTeams();
  await Promise.all([startup, sync]);
  assert.equal(competitionCalls, 1);
  assert.equal(teamCalls, 1);
  assert.equal(pushed.filter((item) => item.payload.competitions).length, 2);
  assert.equal(pushed.filter((item) => item.payload.teams).length, 2);
});

test("a concurrent explicit refresh never joins a normal cached load", async () => {
  const oldCompetitions = [{ code: "PD", name: "Old league" }];
  const oldTeams = [{ id: 90, name: "Old team" }];
  const cache = fakeCache({ "competitions:abc": oldCompetitions, "teams:abc:PD": oldTeams });
  const { catalog, requested, competitionsRequested } = harness({ cache });
  const normal = catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD" } });
  const refresh = catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD", refresh: true } });
  await Promise.all([normal, refresh]);
  assert.deepEqual(competitionsRequested, ["abc"], "refresh must still reach the provider");
  assert.deepEqual(requested, ["abc|PD"], "refresh must still reload teams");
  assert.deepEqual(cache.store["competitions:abc"], competitions);
  assert.deepEqual(cache.store["teams:abc:PD"], teams);
});

test("a sync joins an active refresh instead of replaying warm stale memory", async () => {
  const oldCompetitions = [{ code: "PD", name: "Old league" }];
  const oldTeams = [{ id: 90, name: "Old team" }];
  let competitionCalls = 0;
  let teamCalls = 0;
  let releaseCompetitions;
  let releaseTeams;
  const freshCompetitions = new Promise((resolve) => { releaseCompetitions = () => resolve(competitions); });
  const freshTeams = new Promise((resolve) => { releaseTeams = () => resolve(teams); });
  const pushed = [];
  const catalog = new TeamCatalog({
    service: {
      listCompetitions: async () => { competitionCalls += 1; return competitionCalls === 1 ? oldCompetitions : freshCompetitions; },
      listTeams: async () => { teamCalls += 1; return teamCalls === 1 ? oldTeams : freshTeams; },
    },
    host: { sendToPropertyInspector: (context, payload) => pushed.push({ context, payload }) },
  });
  await catalog.publish({ context: "warm", param: { token: "abc", competition: "PD" } });
  const refresh = catalog.publish({ context: "refresh", param: { token: "abc", competition: "PD", refresh: true } });
  const sync = catalog.publish({ context: "sync", param: { token: "abc", competition: "PD", sync: true } });
  releaseCompetitions();
  await Promise.resolve();
  await Promise.resolve();
  releaseTeams();
  await Promise.all([refresh, sync]);
  assert.deepEqual(pushed.filter((item) => item.context === "sync").map((item) => item.payload), [
    { competitions },
    { teams, competition: "PD" },
  ]);
  assert.equal(competitionCalls, 2);
  assert.equal(teamCalls, 2);
});

test("publishes a bounded failure payload instead of throwing", async () => {
  const { catalog, pushed } = harness({ fail: true });
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD" } });
  assert.deepEqual(pushed.at(-1), { context: "ctx", payload: { teams: [], competition: "PD", error: "teams unavailable" } });
});

test("serves the option lists from the persistent cache without calling the provider", async () => {
  const cache = fakeCache({
    "competitions:abc": competitions,
    "teams:abc:PD": teams,
  });
  const { catalog, pushed, requested, competitionsRequested } = harness({ cache });
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD" } });
  assert.deepEqual(competitionsRequested, [], "a cached competition list must not be refetched");
  assert.deepEqual(requested, [], "a cached team list must not be refetched");
  assert.deepEqual(pushed[0].payload.competitions, competitions);
  assert.deepEqual(pushed[1].payload.teams, teams);
});

test("a cached token still refetches when the competition changes or refresh is requested", async () => {
  const cache = fakeCache({ "competitions:abc": competitions, "teams:abc:PD": teams });
  const { catalog, requested, competitionsRequested, pushed } = harness({ cache });
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD" } });
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PL" } });
  assert.deepEqual(requested, ["abc|PL"], "an uncached competition must be fetched once");

  // An explicit refresh ignores both caches and rewrites them.
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD", refresh: true } });
  assert.deepEqual(requested, ["abc|PL", "abc|PD"]);
  assert.deepEqual(competitionsRequested, ["abc"]);
  assert.deepEqual(cache.store["competitions:abc"], competitions);
  assert.deepEqual(cache.store["teams:abc:PD"], teams);
  assert.deepEqual(pushed.at(-1).payload.teams, teams);
});

test("writes fetched lists into the cache for later restarts", async () => {
  const cache = fakeCache();
  const { catalog } = harness({ cache });
  await catalog.publish({ context: "ctx", param: { token: "abc", competition: "PD" } });
  assert.deepEqual(cache.store["competitions:abc"], competitions);
  assert.deepEqual(cache.store["teams:abc:PD"], teams);
});

test("asks for a token instead of calling the provider without one", async () => {
  const { catalog, pushed, requested } = harness();
  await catalog.publish({ context: "ctx", param: {} });
  assert.deepEqual(requested, []);
  assert.deepEqual(pushed.at(-1), { context: "ctx", payload: { teams: [], error: "token required" } });
});
