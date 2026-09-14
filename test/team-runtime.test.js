"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_TEAM_ID,
  POLL_INTERVAL_MS,
  TeamRuntime,
  formatLocalMatchDate,
  selectNearestMatch,
} = require("../src/plugin/team-runtime.js");

const NOW = new Date("2026-09-14T18:00:00.000Z");
const event = (overrides = {}) => ({
  id: "1", leagueId: "PD", round: "4", homeTeamId: 90, awayTeamId: 559,
  homeTeam: "Real Betis", awayTeam: "Sevilla FC", homeScore: 2, awayScore: 1,
  status: "FINISHED", progress: null, kickoff: "2026-09-14T20:00:00Z",
  date: "2026-09-14", time: "20:00:00", ...overrides,
});

function harness({ matches = [event()], now = () => NOW } = {}) {
  const sent = [];
  const calls = [];
  const timers = [];
  const cleared = [];
  const service = {
    listMatches: async (...args) => {
      calls.push(args);
      return typeof matches === "function" ? matches(calls.length) : matches;
    },
  };
  const runtime = new TeamRuntime({
    host: { setBaseDataIcon: (context, data) => sent.push({ context, data }) },
    service,
    render: (text) => text,
    now,
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeout: (timer) => cleared.push(timer),
  });
  return { runtime, sent, calls, timers, cleared };
}

const settings = (overrides = {}) => ({
  context: "ctx",
  param: { token: "t", competition: "PD", teamId: 90, teamLabel: "Betis", ...overrides },
});

test("formatLocalMatchDate prefers kickoff and uses the host locale and timezone", () => {
  const kickoff = "2026-09-14T23:30:00.000Z";
  assert.equal(
    formatLocalMatchDate(event({ kickoff, date: "1999-01-01" })),
    new Date(kickoff).toLocaleDateString(),
  );
});

test("formatLocalMatchDate safely falls back to a valid date-only value", () => {
  const expected = new Date(2026, 8, 14).toLocaleDateString();
  assert.equal(formatLocalMatchDate(event({ kickoff: "invalid", date: "2026-09-14" })), expected);
  assert.equal(formatLocalMatchDate(event({ kickoff: null, date: "2026-09-14" })), expected);
  assert.equal(formatLocalMatchDate(event({ kickoff: "invalid", date: "2026-02-30" })), null);
  assert.equal(formatLocalMatchDate(event({ kickoff: "invalid", date: "not-a-date" })), null);
});

test("selectNearestMatch chooses absolute proximity and future wins a tie", () => {
  const past = event({ id: "past", kickoff: "2026-09-14T17:00:00Z" });
  const future = event({ id: "future", kickoff: "2026-09-14T19:00:00Z" });
  const nearerPast = event({ id: "near", kickoff: "2026-09-14T17:30:00Z" });
  assert.equal(selectNearestMatch([past, future], NOW, 90).id, "future");
  assert.equal(selectNearestMatch([future, nearerPast], NOW, 90).id, "near");
  assert.equal(selectNearestMatch([event({ homeTeamId: 1, awayTeamId: 2 })], NOW, 90), null);
});

test("TeamRuntime loads the selected team's nearest match without a configured date", async () => {
  const h = harness({ matches: [
    event({ id: "far", kickoff: "2026-09-16T20:00:00Z", date: "2026-09-16" }),
    event({ id: "near", kickoff: "2026-09-13T20:00:00Z", date: "2026-09-13" }),
  ] });
  await h.runtime.refresh(settings());
  assert.equal(DEFAULT_TEAM_ID, 90);
  assert.deepEqual(h.calls, [[90, "t", "PD", NOW]]);
  const displayedDate = new Date("2026-09-13T20:00:00Z").toLocaleDateString();
  assert.deepEqual(h.sent, [
    { context: "ctx", data: "Betis\nLoading…" },
    { context: "ctx", data: `Real Betis\nSevilla FC\n2 - 1\n${displayedDate}` },
  ]);
});

test("TeamRuntime shows kickoff time before a match and hides provider failures", async () => {
  const pending = harness({ matches: [event({ status: "TIMED", homeScore: null, awayScore: null, kickoff: "2026-09-15T19:00:00Z", date: "2026-09-15", time: "19:00:00" })] });
  await pending.runtime.refresh(settings());
  const displayedDate = new Date("2026-09-15T19:00:00Z").toLocaleDateString();
  assert.equal(pending.sent.at(-1).data, `Real Betis\nSevilla FC\n19:00\n${displayedDate}`);

  const none = harness({ matches: [] });
  await none.runtime.refresh(settings());
  assert.equal(none.sent.at(-1).data, "Betis\nNo match");

  const failed = harness({ matches: () => { throw new Error("private URL"); } });
  await failed.runtime.refresh(settings());
  assert.equal(failed.sent.at(-1).data, "Betis\nData unavailable");

  const missing = harness();
  await missing.runtime.refresh(settings({ token: "" }));
  assert.equal(missing.sent.at(-1).data, "Betis\nAdd token");
  assert.equal(missing.calls.length, 0);
});

test("TeamRuntime loads both crests and passes them to the renderer", async () => {
  const rendered = [];
  const urls = [];
  const match = event({
    homeCrestUrl: "https://crests.football-data.org/90.png",
    awayCrestUrl: "https://crests.football-data.org/559.svg",
  });
  const runtime = new TeamRuntime({
    host: { setBaseDataIcon: () => {} },
    service: {
      listMatches: async () => [match],
      loadCrest: async (url) => { urls.push(url); return `data:image/png;base64,${Buffer.from(url).toString("base64")}`; },
    },
    render: (text, options) => { rendered.push({ text, options }); return text; },
    now: () => NOW,
  });
  await runtime.refresh(settings());
  assert.deepEqual(urls, [match.homeCrestUrl, match.awayCrestUrl]);
  assert.match(rendered.at(-1).options.homeCrest, /^data:image\/png;base64,/);
  assert.match(rendered.at(-1).options.awayCrest, /^data:image\/png;base64,/);
});

test("today's unfinished match polls once after exactly two minutes", async () => {
  const h = harness({ matches: [event({ status: "TIMED", homeScore: null, awayScore: null })] });
  await h.runtime.refresh(settings());
  assert.equal(POLL_INTERVAL_MS, 120000);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delay, 120000);
  await h.timers[0].callback();
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.length, 2, "the completed poll schedules one next one-shot timer");
});

test("future-day and terminal matches never poll", async () => {
  const future = harness({ matches: [event({ status: "TIMED", kickoff: "2026-09-15T18:00:00Z", date: "2026-09-15" })] });
  await future.runtime.refresh(settings());
  assert.equal(future.timers.length, 0);

  for (const status of ["FINISHED", "CANCELLED", "POSTPONED", "SUSPENDED", "AWARDED"]) {
    const terminal = harness({ matches: [event({ status })] });
    await terminal.runtime.refresh(settings());
    assert.equal(terminal.timers.length, 0, status);
  }
});

test("polling stops when the match becomes finished", async () => {
  const h = harness({ matches: (call) => [event({ status: call === 1 ? "IN_PLAY" : "FINISHED" })] });
  await h.runtime.refresh(settings());
  await h.timers[0].callback();
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.length, 1, "no replacement timer is scheduled after FINISHED");
});

test("manual refresh replaces the timer and stale responses cannot schedule one", async () => {
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  let calls = 0;
  const h = harness({ matches: () => { calls += 1; return calls === 1 ? first : [event({ status: "FINISHED" })]; } });
  const stale = h.runtime.refresh(settings());
  await h.runtime.refresh(settings({ teamId: 559, teamLabel: "Sevilla" }));
  resolveFirst([event({ status: "IN_PLAY" })]);
  await stale;
  assert.equal(h.timers.length, 0, "the stale request cannot restore polling");
});

test("clear and dispose cancel owned timers", async () => {
  const h = harness({ matches: [event({ status: "IN_PLAY" })] });
  await h.runtime.refresh(settings());
  h.runtime.clear({ param: [{ context: "ctx" }] });
  assert.deepEqual(h.cleared, [h.timers[0]]);

  await h.runtime.refresh(settings({ context: "a" }));
  await h.runtime.refresh({ context: "b", param: settings().param });
  h.runtime.dispose();
  assert.ok(h.cleared.includes(h.timers.at(-1)));
  assert.ok(h.cleared.includes(h.timers.at(-2)));
});
