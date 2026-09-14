"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  DEFAULT_TEAM_ID,
  POLL_INTERVAL_MS,
  TeamRuntime,
  formatLocalKickoffTime,
  formatLocalMatchDate,
  renderMatch,
  selectNearestMatch,
} = require("../src/plugin/team-runtime.js");

const NOW = new Date("2026-09-14T18:00:00.000Z");
const event = (overrides = {}) => ({
  id: "1", leagueId: "PD", round: "4", homeTeamId: 90, awayTeamId: 559,
  homeTeam: "Real Betis", awayTeam: "Sevilla FC", homeScore: 2, awayScore: 1,
  status: "FINISHED", progress: null, kickoff: "2026-09-14T20:00:00Z",
  date: "2026-09-14", time: "20:00:00", ...overrides,
});

function harness({ matches = [event()], now = () => NOW, alert = () => {} } = {}) {
  const sent = [];
  const calls = [];
  const timers = [];
  const cleared = [];
  const rendered = [];
  const service = {
    listMatches: async (...args) => {
      calls.push(args);
      return typeof matches === "function" ? matches(calls.length) : matches;
    },
  };
  const runtime = new TeamRuntime({
    host: { setBaseDataIcon: (context, data) => sent.push({ context, data }) },
    service,
    render: (text, options) => { rendered.push({ text, options }); return text; },
    alert,
    now,
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeout: (timer) => cleared.push(timer),
  });
  return { runtime, sent, calls, timers, cleared, rendered };
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

test("formatLocalKickoffTime uses local hours and zero-padded minutes", () => {
  const localKickoff = new Date(2026, 8, 14, 5, 7);

  assert.equal(formatLocalKickoffTime(event({ kickoff: localKickoff.toISOString() })), "05:07");
});

test("renderMatch uses local kickoff time instead of the provider UTC time", () => {
  const localKickoff = new Date(2026, 8, 14, 5, 7);
  const rendered = renderMatch(event({
    kickoff: localKickoff.toISOString(),
    time: "22:22:00",
    homeScore: null,
    awayScore: null,
    status: "TIMED",
  }), new Date(2026, 8, 13, 12));

  assert.equal(rendered.split("\n")[2], "05:07");
});

test("formatLocalKickoffTime has a bounded legacy fallback and rejects invalid inputs", () => {
  assert.equal(formatLocalKickoffTime(event({ kickoff: "invalid", time: "09:05:30" })), "09:05");
  assert.equal(formatLocalKickoffTime(event({ kickoff: null, time: "23:59" })), "23:59");

  for (const time of ["9:05", "24:00", "12:60", "12:30 UTC", "Invalid Date", null]) {
    assert.equal(formatLocalKickoffTime(event({ kickoff: "invalid", time })), null, String(time));
  }
});

test("formatLocalKickoffTime converts a known UTC instant in an isolated timezone", () => {
  const runtimePath = require.resolve("../src/plugin/team-runtime.js");
  const script = `const { formatLocalKickoffTime } = require(${JSON.stringify(runtimePath)}); process.stdout.write(formatLocalKickoffTime({ kickoff: "2026-09-14T20:07:00.000Z" }) ?? "null");`;
  const output = execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    env: { ...process.env, TZ: "America/New_York" },
  });

  assert.equal(output, "16:07");
});

test("renderMatch uses contextual status text for today's match", () => {
  const kickoff = new Date(2026, 8, 14, 20).toISOString();
  const reference = new Date(2026, 8, 14, 12);
  const cases = [
    { statuses: ["SCHEDULED", "TIMED"], expected: "STARTING SOON" },
    { statuses: ["IN_PLAY", "PAUSED", "LIVE"], expected: "LIVE" },
    { statuses: ["FINISHED"], expected: "FINISHED" },
  ];

  for (const { statuses, expected } of cases) {
    for (const status of statuses) {
      const rendered = renderMatch(event({ kickoff, status }), reference);
      assert.equal(rendered.split("\n").at(-1), expected, status);
    }
  }
});

test("renderMatch keeps the host-localized date outside the local match day", () => {
  const kickoff = new Date(2026, 8, 14, 23, 30).toISOString();
  const reference = new Date(2026, 8, 15, 12);
  const expected = new Date(kickoff).toLocaleDateString();

  assert.equal(renderMatch(event({ kickoff, status: "TIMED" }), reference).split("\n").at(-1), expected);
});

test("renderMatch derives calendar-day equality from the kickoff instant in the host timezone", () => {
  const kickoff = "2026-09-14T23:30:00.000Z";
  const localKickoff = new Date(kickoff);
  const sameLocalDay = new Date(
    localKickoff.getFullYear(),
    localKickoff.getMonth(),
    localKickoff.getDate(),
    12,
  );

  assert.equal(renderMatch(event({ kickoff, status: "TIMED" }), sameLocalDay).split("\n").at(-1), "STARTING SOON");
});

test("renderMatch keeps the localized date for anomalous statuses", () => {
  const kickoff = new Date(2026, 8, 14, 20).toISOString();
  const reference = new Date(2026, 8, 14, 12);
  const expected = new Date(kickoff).toLocaleDateString();

  for (const status of ["CANCELLED", "POSTPONED", "SUSPENDED", "AWARDED"]) {
    assert.equal(renderMatch(event({ kickoff, status }), reference).split("\n").at(-1), expected, status);
  }
});

test("renderMatch never emits false contextual text or Invalid Date for invalid inputs", () => {
  const validKickoff = new Date(2026, 8, 14, 20).toISOString();
  const expectedKickoffDate = new Date(validKickoff).toLocaleDateString();
  const expectedFallbackDate = new Date(2026, 8, 14).toLocaleDateString();

  assert.equal(
    renderMatch(event({ kickoff: validKickoff, status: "FINISHED" }), new Date("invalid")).split("\n").at(-1),
    expectedKickoffDate,
  );
  assert.equal(
    renderMatch(event({ kickoff: "invalid", date: "2026-09-14", status: "FINISHED" }), new Date(2026, 8, 14, 12)).split("\n").at(-1),
    expectedFallbackDate,
  );
  assert.doesNotMatch(renderMatch(event({ kickoff: "invalid", date: "invalid", status: "LIVE" }), new Date()), /Invalid Date|LIVE$/);
});

test("TeamRuntime.refresh passes its injected reference clock to match rendering", async () => {
  const kickoff = new Date(2026, 8, 14, 20).toISOString();
  const reference = new Date(2026, 8, 14, 12);
  const h = harness({ matches: [event({ kickoff, status: "TIMED" })], now: () => reference });

  await h.runtime.refresh(settings());

  assert.equal(h.rendered.at(-1).text.split("\n").at(-1), "STARTING SOON");
  assert.strictEqual(h.calls.at(-1).at(-1), reference);
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
  const pendingKickoff = "2026-09-15T19:00:00Z";
  const pending = harness({ matches: [event({ status: "TIMED", homeScore: null, awayScore: null, kickoff: pendingKickoff, date: "2026-09-15", time: "19:00:00" })] });
  await pending.runtime.refresh(settings());
  const pendingDate = new Date(pendingKickoff);
  const displayedDate = pendingDate.toLocaleDateString();
  const displayedTime = `${String(pendingDate.getHours()).padStart(2, "0")}:${String(pendingDate.getMinutes()).padStart(2, "0")}`;
  assert.equal(pending.sent.at(-1).data, `Real Betis\nSevilla FC\n${displayedTime}\n${displayedDate}`);

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

test("TeamRuntime marks IN_PLAY, PAUSED and LIVE matches as live even when crests fail", async () => {
  for (const status of ["IN_PLAY", "PAUSED", "LIVE"]) {
    const h = harness({ matches: [event({ status })] });
    await h.runtime.refresh(settings());
    assert.equal(h.rendered.at(-1).options.live, true, status);
  }
  const finished = harness({ matches: [event({ status: "FINISHED" })] });
  await finished.runtime.refresh(settings());
  assert.equal(finished.rendered.at(-1).options.live, false);
});

test("initial score is silent and later changes alert once, including corrections", async () => {
  const alerts = [];
  const sequence = [
    event({ status: "IN_PLAY", homeScore: 1, awayScore: 0 }),
    event({ status: "IN_PLAY", homeScore: 2, awayScore: 0 }),
    event({ status: "IN_PLAY", homeScore: 2, awayScore: 0 }),
    event({ status: "PAUSED", homeScore: 1, awayScore: 0 }),
  ];
  const h = harness({ matches: (call) => [sequence[call - 1]], alert: () => alerts.push("play") });
  for (const _match of sequence) await h.runtime.refresh(settings());
  assert.deepEqual(alerts, ["play", "play"]);
});

test("a pre-match null score becomes a silent 0-0 baseline before the first goal", async () => {
  const alerts = [];
  const sequence = [
    event({ status: "TIMED", homeScore: null, awayScore: null }),
    event({ status: "IN_PLAY", homeScore: 0, awayScore: 0 }),
    event({ status: "IN_PLAY", homeScore: 1, awayScore: 0 }),
  ];
  const h = harness({ matches: (call) => [sequence[call - 1]], alert: () => alerts.push("play") });
  for (const _match of sequence) await h.runtime.refresh(settings());
  assert.deepEqual(alerts, ["play"]);
});

test("selection and match changes establish new silent baselines", async () => {
  const alerts = [];
  let current = event({ id: "one", status: "IN_PLAY", homeScore: 0, awayScore: 0 });
  const h = harness({ matches: () => [current], alert: () => alerts.push("play") });
  await h.runtime.refresh(settings());
  current = event({ id: "one", status: "IN_PLAY", homeScore: 1, awayScore: 0 });
  await h.runtime.refresh(settings());
  current = event({ id: "two", status: "IN_PLAY", homeScore: 3, awayScore: 2 });
  await h.runtime.refresh(settings());
  current = event({ id: "two", status: "IN_PLAY", homeScore: 4, awayScore: 2 });
  await h.runtime.refresh(settings({ competition: "PL" }));
  current = event({ id: "two", status: "IN_PLAY", homeScore: 5, awayScore: 2 });
  await h.runtime.refresh(settings({ competition: "PL" }));
  assert.deepEqual(alerts, ["play", "play"]);
});

test("stale responses neither alert nor overwrite the current score baseline", async () => {
  const alerts = [];
  let resolveStale;
  const staleMatch = new Promise((resolve) => { resolveStale = resolve; });
  let call = 0;
  const h = harness({
    matches: () => {
      call += 1;
      if (call === 1) return [event({ status: "IN_PLAY", homeScore: 0, awayScore: 0 })];
      if (call === 2) return staleMatch;
      return [event({ status: "IN_PLAY", homeScore: 2, awayScore: 0 })];
    },
    alert: () => alerts.push("play"),
  });
  await h.runtime.refresh(settings());
  const stale = h.runtime.refresh(settings());
  await h.runtime.refresh(settings());
  resolveStale([event({ status: "IN_PLAY", homeScore: 1, awayScore: 0 })]);
  await stale;
  await h.runtime.refresh(settings());
  assert.deepEqual(alerts, ["play"]);
});

test("a response made stale while loading crests cannot alter the baseline or alert", async () => {
  const alerts = [];
  let releaseCrest;
  const slowCrest = new Promise((resolve) => { releaseCrest = resolve; });
  let call = 0;
  const runtime = new TeamRuntime({
    host: { setBaseDataIcon: () => {} },
    service: {
      listMatches: async () => {
        call += 1;
        if (call === 1) return [event({ status: "IN_PLAY", homeScore: 0, awayScore: 0 })];
        if (call === 2) return [event({ status: "IN_PLAY", homeScore: 1, awayScore: 0, homeCrestUrl: "https://crests.football-data.org/90.png" })];
        return [event({ status: "IN_PLAY", homeScore: 2, awayScore: 0 })];
      },
      loadCrest: async () => slowCrest,
    },
    render: (text) => text,
    now: () => NOW,
    alert: () => alerts.push("play"),
    setTimeout: () => ({}),
    clearTimeout: () => {},
  });
  await runtime.refresh(settings());
  const stale = runtime.refresh(settings());
  await new Promise((resolve) => setImmediate(resolve));
  await runtime.refresh(settings());
  releaseCrest(null);
  await stale;
  await runtime.refresh(settings());
  assert.deepEqual(alerts, ["play"]);
});

test("audio failures are contained and polling/rendering continue", async () => {
  const h = harness({
    matches: (call) => [event({ status: "IN_PLAY", homeScore: call - 1, awayScore: 0 })],
    alert: () => { throw new Error("speaker unavailable"); },
  });
  await h.runtime.refresh(settings());
  await h.runtime.refresh(settings());
  assert.match(h.sent.at(-1).data, /1 - 0/);
  assert.ok(h.timers.length >= 2);
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

test("scheduled polling preserves the current image until it emits only the successful update", async () => {
  let resolvePoll;
  const pollResult = new Promise((resolve) => { resolvePoll = resolve; });
  const h = harness({
    matches: (call) => call === 1
      ? [event({ status: "IN_PLAY", homeScore: 0, awayScore: 0 })]
      : pollResult,
  });
  await h.runtime.refresh(settings());
  const sentBeforePoll = h.sent.length;

  const poll = h.timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.sent.length, sentBeforePoll, "background polling must not draw Loading…");

  resolvePoll([event({ status: "IN_PLAY", homeScore: 1, awayScore: 0 })]);
  await poll;
  assert.equal(h.sent.length, sentBeforePoll + 1);
  assert.match(h.sent.at(-1).data, /1 - 0/);
  assert.doesNotMatch(h.sent.at(-1).data, /Loading…/);
});

test("scheduled polling replaces the current image with Data unavailable on error", async () => {
  const h = harness({
    matches: (call) => {
      if (call === 1) return [event({ status: "IN_PLAY" })];
      throw new Error("provider unavailable");
    },
  });
  await h.runtime.refresh(settings());
  const sentBeforePoll = h.sent.length;

  await h.timers[0].callback();

  assert.deepEqual(h.sent.slice(sentBeforePoll), [{ context: "ctx", data: "Betis\nData unavailable" }]);
});

test("initial and manual foreground refreshes continue to emit Loading…", async () => {
  const h = harness({ matches: [event({ status: "IN_PLAY" })] });

  await h.runtime.refresh(settings());
  await h.runtime.refresh(settings());

  assert.equal(h.sent.filter(({ data }) => data === "Betis\nLoading…").length, 2);
});

test("a stale background response cannot draw, alert, change the baseline or schedule a timer", async () => {
  let resolvePoll;
  const pollResult = new Promise((resolve) => { resolvePoll = resolve; });
  const alerts = [];
  const h = harness({
    matches: (call) => {
      if (call === 1) return [event({ status: "IN_PLAY", homeScore: 0, awayScore: 0 })];
      if (call === 2) return pollResult;
      return [event({ status: "IN_PLAY", homeScore: 2, awayScore: 0 })];
    },
    alert: () => alerts.push("play"),
  });
  await h.runtime.refresh(settings());
  const stalePoll = h.timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  await h.runtime.refresh(settings());
  const stateAfterForeground = {
    sent: h.sent.length,
    alerts: alerts.length,
    timers: h.timers.length,
  };

  resolvePoll([event({ status: "IN_PLAY", homeScore: 1, awayScore: 0 })]);
  await stalePoll;

  assert.deepEqual(
    { sent: h.sent.length, alerts: alerts.length, timers: h.timers.length },
    stateAfterForeground,
  );
  await h.runtime.refresh(settings());
  assert.equal(alerts.length, stateAfterForeground.alerts, "the stale score never became the baseline");
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
