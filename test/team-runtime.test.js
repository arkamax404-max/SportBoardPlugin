"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  DEFAULT_TEAM_ID,
  MAX_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  TeamRuntime,
  decideMatchSchedule,
  describeLiveMatch,
  describeScheduledMatch,
  formatLocalKickoffTime,
  formatLocalMatchDate,
  renderMatch,
  selectLastFinishedMatch,
  selectNearestMatch,
  selectNextMatch,
} = require("../src/plugin/team-runtime.js");

const NOW = new Date("2026-09-14T18:00:00.000Z");
const event = (overrides = {}) => ({
  id: "1", leagueId: "PD", round: "4", homeTeamId: 90, awayTeamId: 559,
  homeTeam: "Real Betis", awayTeam: "Sevilla FC", homeScore: 2, awayScore: 1,
  status: "FINISHED", progress: null, kickoff: "2026-09-14T20:00:00Z",
  date: "2026-09-14", time: "20:00:00", ...overrides,
});

function harness({ matches = [event()], now = () => NOW, alert = () => {}, loadCrest, loadMatchDetail, maxTimeout } = {}) {
  const sent = [];
  const calls = [];
  const timers = [];
  const cleared = [];
  const progressTimers = [];
  const progressCleared = [];
  const rendered = [];
  const detailCalls = [];
  const service = {
    listMatches: async (...args) => {
      calls.push(args);
      return typeof matches === "function" ? matches(calls.length) : matches;
    },
  };
  if (loadCrest) service.loadCrest = loadCrest;
  if (loadMatchDetail) service.loadMatchDetail = async (...args) => {
    detailCalls.push(args);
    return loadMatchDetail(...args);
  };
  const runtime = new TeamRuntime({
    host: { setBaseDataIcon: (context, data) => sent.push({ context, data }) },
    service,
    render: (text, options) => { rendered.push({ text, options }); return text; },
    alert,
    now,
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeout: (timer) => cleared.push(timer),
    setProgressTimeout: (callback, delay) => { const timer = { callback, delay }; progressTimers.push(timer); return timer; },
    clearProgressTimeout: (timer) => progressCleared.push(timer),
    maxTimeout,
  });
  return { runtime, sent, calls, detailCalls, timers, cleared, progressTimers, progressCleared, rendered };
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

test("scheduled countdown rounds remaining minutes up and reaches zero at kickoff", () => {
  const reference = new Date(2026, 8, 14, 12);
  const cases = [
    { remaining: 2 * 60 * 60 * 1000 + 34 * 60 * 1000 + 10000, expected: "START IN 02:35" },
    { remaining: 1, expected: "START IN 00:01" },
    { remaining: 0, expected: "START IN 00:00" },
    { remaining: -1, expected: "START IN 00:00" },
  ];
  for (const { remaining, expected } of cases) {
    const match = event({ status: "TIMED", kickoff: new Date(reference.getTime() + remaining).toISOString() });
    assert.equal(describeScheduledMatch(match, reference).text, expected);
  }
});

test("renderMatch uses contextual status text for today's match", () => {
  const kickoff = new Date(2026, 8, 14, 20).toISOString();
  const reference = new Date(2026, 8, 14, 12);
  const cases = [
    { statuses: ["SCHEDULED", "TIMED"], expected: "START IN 08:00" },
    { statuses: ["IN_PLAY", "LIVE"], expected: "START IN 08:00" },
    { statuses: ["PAUSED"], expected: "HALF TIME" },
    { statuses: ["FINISHED"], expected: "FINISHED" },
  ];

  for (const { statuses, expected } of cases) {
    for (const status of statuses) {
      const rendered = renderMatch(event({ kickoff, status }), reference);
      assert.equal(rendered.split("\n").at(-1), expected, status);
    }
  }
});

test("describeLiveMatch derives periods and stoppage time from the validated clock", () => {
  const cases = [
    { match: { status: "IN_PLAY", minute: 0 }, expected: "1ST HALF 0'" },
    { match: { status: "LIVE", minute: 1 }, expected: "1ST HALF 1'" },
    { match: { status: "IN_PLAY", minute: 45, injuryTime: 2 }, expected: "1ST HALF 45+2'" },
    { match: { status: "PAUSED", minute: 45 }, expected: "HALF TIME 45'" },
    { match: { status: "PAUSED" }, expected: "HALF TIME" },
    { match: { status: "IN_PLAY", minute: 46 }, expected: "2ND HALF 46'" },
    { match: { status: "LIVE", minute: 90, injuryTime: 3 }, expected: "2ND HALF 90+3'" },
    { match: { status: "IN_PLAY", minute: 91 }, expected: "EXTRA TIME 91'" },
    { match: { status: "LIVE", minute: 103, injuryTime: 1 }, expected: "EXTRA TIME 103+1'" },
    { match: { status: "PAUSED", minute: 45, injuryTime: 2 }, expected: "HALF TIME 45+2'" },
    { match: { status: "IN_PLAY", minute: 34, injuryTime: 0 }, expected: "1ST HALF 34'" },
  ];

  for (const { match, expected } of cases) {
    assert.equal(describeLiveMatch(match), expected, JSON.stringify(match));
  }
});

test("describeLiveMatch safely handles missing and malformed clocks", () => {
  for (const minute of [undefined, null, "34", -1, Number.NaN, 34.5]) {
    assert.equal(describeLiveMatch({ status: "IN_PLAY", minute, injuryTime: 2 }), "LIVE", String(minute));
    assert.equal(describeLiveMatch({ status: "PAUSED", minute, injuryTime: 2 }), "HALF TIME", String(minute));
  }

  for (const injuryTime of ["2", -1, Number.NaN, 2.5]) {
    assert.equal(describeLiveMatch({ status: "LIVE", minute: 45, injuryTime }), "1ST HALF 45'", String(injuryTime));
  }

  assert.equal(describeLiveMatch({ status: "FINISHED", minute: 90 }), null);
  assert.equal(describeLiveMatch({ status: "TIMED", minute: 0 }), null);
});

test("describeLiveMatch estimates bounded phases from kickoff when the official clock is unavailable", () => {
  const kickoff = NOW.getTime();
  const active = event({ status: "IN_PLAY", minute: null, kickoff: NOW.toISOString() });
  const cases = [
    { elapsed: -1, expected: "START IN 00:01" },
    { elapsed: 0, expected: "~1ST HALF 0'" },
    { elapsed: 45 * 60000 - 1, expected: "~1ST HALF 44'" },
    { elapsed: 45 * 60000, expected: "~HALF TIME" },
    { elapsed: 60 * 60000 - 1, expected: "~HALF TIME" },
    { elapsed: 60 * 60000, expected: "~2ND HALF 45'" },
    { elapsed: 3 * 60 * 60000, expected: "~2ND HALF 90'" },
  ];

  for (const { elapsed, expected } of cases) {
    assert.equal(describeLiveMatch(active, new Date(kickoff + elapsed)), expected, String(elapsed));
  }
});

test("official clock and period data take precedence over kickoff estimates", () => {
  const afterRegulation = new Date(NOW.getTime() + 3 * 60 * 60000);
  assert.equal(describeLiveMatch(event({ status: "IN_PLAY", minute: 67, kickoff: NOW.toISOString() }), afterRegulation), "2ND HALF 67'");
  assert.equal(describeLiveMatch(event({ status: "PAUSED", minute: null, kickoff: NOW.toISOString() }), afterRegulation), "HALF TIME");
  assert.equal(renderMatch(event({ status: "IN_PLAY", minute: 67, kickoff: NOW.toISOString() }), afterRegulation).split("\n").at(-1), "2ND HALF 67'");
  assert.equal(renderMatch(event({ status: "IN_PLAY", minute: null, kickoff: NOW.toISOString() }), afterRegulation).split("\n").at(-1), "~2ND HALF 90'");
});

test("missing clocks with invalid kickoff data retain the generic live fallback", () => {
  assert.equal(describeLiveMatch(event({ status: "LIVE", minute: null, kickoff: "invalid" }), NOW), "LIVE");
});

test("renderMatch places the derived live clock in the existing lower row", () => {
  const kickoff = new Date(2026, 8, 14, 20).toISOString();
  const reference = new Date(2026, 8, 14, 12);
  const rendered = renderMatch(event({ kickoff, status: "IN_PLAY", minute: 67 }), reference);

  assert.equal(rendered.split("\n").length, 4);
  assert.equal(rendered.split("\n").at(-1), "2ND HALF 67'");
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
    0,
  );

  const remainingMinutes = Math.ceil((Date.parse(kickoff) - sameLocalDay.getTime()) / 60000);
  const expected = `START IN ${String(Math.floor(remainingMinutes / 60)).padStart(2, "0")}:${String(remainingMinutes % 60).padStart(2, "0")}`;
  assert.equal(renderMatch(event({ kickoff, status: "TIMED" }), sameLocalDay).split("\n").at(-1), expected);
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

  assert.equal(h.rendered.at(-1).text.split("\n").at(-1), "START IN 08:00");
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

test("last and next selectors are pure, status-bounded and deterministic", () => {
  const matches = [
    event({ id: "b", status: "FINISHED", kickoff: "2026-09-14T17:00:00Z" }),
    event({ id: "a", status: "FINISHED", kickoff: "2026-09-14T17:00:00Z" }),
    event({ id: "future-finished", status: "FINISHED", kickoff: "2026-09-14T19:00:00Z" }),
    event({ id: "lowercase", status: "finished", kickoff: "2026-09-14T17:30:00Z" }),
    event({ id: "timed", status: "TIMED", kickoff: "2026-09-14T19:00:00Z" }),
    event({ id: "scheduled", status: "SCHEDULED", kickoff: "2026-09-14T19:00:00Z" }),
    event({ id: "now", status: "TIMED", kickoff: NOW.toISOString() }),
    event({ id: "invalid", status: "TIMED", kickoff: "invalid" }),
    event({ id: "other", status: "TIMED", kickoff: "2026-09-14T18:30:00Z", homeTeamId: 1, awayTeamId: 2 }),
  ];
  const snapshot = [...matches];

  assert.equal(selectLastFinishedMatch(matches, NOW, 90).id, "a");
  assert.equal(selectNextMatch(matches, NOW, 90).id, "scheduled");
  assert.deepEqual(matches, snapshot, "selectors must not reorder or mutate API results");
  assert.equal(selectLastFinishedMatch(matches, new Date("invalid"), 90), null);
  assert.equal(selectNextMatch(null, NOW, 90), null);
});

test("selectNextMatch prioritizes active matches and resolves anomalous multiples deterministically", () => {
  const upcoming = event({ id: "upcoming", status: "TIMED", kickoff: "2026-09-14T18:01:00Z" });
  const pastLive = event({ id: "past-live", status: "IN_PLAY", kickoff: "2026-09-14T17:30:00Z" });
  assert.equal(selectNextMatch([upcoming, pastLive], NOW, 90).id, "past-live", "active outranks a closer future fixture");

  const tied = [
    event({ id: "b", status: "PAUSED", kickoff: "2026-09-14T17:00:00Z" }),
    event({ id: "a", status: "LIVE", kickoff: "2026-09-14T19:00:00Z" }),
  ];
  assert.equal(selectNextMatch(tied, NOW, 90).id, "a", "equal active distance breaks by id, not array order");
  assert.equal(selectNextMatch([...tied].reverse(), NOW, 90).id, "a");
  assert.equal(selectNextMatch([
    ...tied,
    event({ id: "nearest", status: "IN_PLAY", kickoff: "2026-09-14T17:45:00Z" }),
    event({ id: "invalid", status: "LIVE", kickoff: "invalid" }),
    event({ id: "other", status: "LIVE", kickoff: NOW.toISOString(), homeTeamId: 1, awayTeamId: 2 }),
  ], NOW, 90).id, "nearest");
});

test("decideMatchSchedule compares parsed UTC instants as epoch milliseconds", () => {
  const future = "2026-09-14T18:10:00.000Z";
  assert.deepEqual(decideMatchSchedule(event({ status: "TIMED", kickoff: future }), NOW), {
    kind: "wake-at-kickoff",
    kickoff: Date.parse(future),
  });
  assert.deepEqual(decideMatchSchedule(event({ status: "SCHEDULED", kickoff: "2026-09-14T17:59:59.999Z" }), NOW), {
    kind: "poll-in-2m",
    delay: POLL_INTERVAL_MS,
  });
  assert.deepEqual(decideMatchSchedule(event({ status: "LIVE", kickoff: "2026-09-13T23:00:00Z" }), NOW), {
    kind: "poll-in-2m",
    delay: POLL_INTERVAL_MS,
  });
  assert.deepEqual(decideMatchSchedule({ status: "TIMED", utcDate: future }, NOW), {
    kind: "wake-at-kickoff",
    kickoff: Date.parse(future),
  });
  for (const status of ["FINISHED", "CANCELLED", "POSTPONED", "SUSPENDED", "AWARDED", "UNKNOWN"]) {
    assert.deepEqual(decideMatchSchedule(event({ status }), NOW), { kind: "none" }, status);
  }
  assert.deepEqual(decideMatchSchedule(event({ status: "TIMED", kickoff: "invalid" }), NOW), { kind: "none" });
  assert.deepEqual(decideMatchSchedule(event({ status: "TIMED" }), new Date("invalid")), { kind: "none" });
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

test("TeamRuntime starts nearest and first press branches from finished, upcoming or live", async () => {
  const cases = [
    {
      name: "finished",
      matches: [
        event({ id: "last", homeTeam: "Last Home", status: "FINISHED", kickoff: "2026-09-14T17:30:00Z" }),
        event({ id: "next", homeTeam: "Next Home", status: "TIMED", kickoff: "2026-09-14T20:00:00Z", homeScore: null, awayScore: null }),
      ],
      initial: "Last Home",
      toggled: "Next Home",
    },
    {
      name: "upcoming",
      matches: [
        event({ id: "last", homeTeam: "Last Home", status: "FINISHED", kickoff: "2026-09-14T15:00:00Z" }),
        event({ id: "next", homeTeam: "Next Home", status: "SCHEDULED", kickoff: "2026-09-14T18:30:00Z", homeScore: null, awayScore: null }),
      ],
      initial: "Next Home",
      toggled: "Last Home",
    },
    {
      name: "live",
      matches: [
        event({ id: "last", homeTeam: "Last Home", status: "FINISHED", kickoff: "2026-09-14T15:00:00Z" }),
        event({ id: "live", homeTeam: "Live Home", status: "IN_PLAY", kickoff: "2026-09-14T17:55:00Z" }),
      ],
      initial: "Live Home",
      toggled: "Last Home",
    },
  ];

  for (const item of cases) {
    const h = harness({ matches: item.matches });
    await h.runtime.refresh(settings(), { resetMode: "always" });
    assert.match(h.sent.at(-1).data, new RegExp(item.initial), `${item.name} initial nearest`);
    await h.runtime.toggle({ context: "ctx" });
    assert.match(h.sent.at(-1).data, new RegExp(item.toggled), `${item.name} first toggle`);
    await h.runtime.toggle({ context: "ctx" });
    assert.match(h.sent.at(-1).data, new RegExp(item.initial), `${item.name} repeated toggle returns to its category`);
  }
});

test("TeamRuntime alternates modes, reuses settings on paramless runs and retains empty modes", async () => {
  const matches = [
    event({ id: "last", homeTeam: "Last Home", status: "FINISHED", kickoff: "2026-09-14T17:00:00Z" }),
    event({ id: "next", homeTeam: "Next Home", status: "TIMED", kickoff: "2026-09-14T19:00:00Z", homeScore: null, awayScore: null }),
  ];
  const h = harness({ matches });
  await h.runtime.refresh(settings(), { resetMode: "always" });
  await h.runtime.toggle({ context: "ctx" });
  assert.match(h.sent.at(-1).data, /Last Home/);
  await h.runtime.toggle({ context: "ctx" });
  assert.match(h.sent.at(-1).data, /Next Home/);
  await h.runtime.toggle({ context: "ctx" });
  assert.match(h.sent.at(-1).data, /Last Home/);
  assert.deepEqual(h.calls.map((call) => call.slice(0, 3)), Array(4).fill([90, "t", "PD"]));

  const empty = harness({ matches: [] });
  await empty.runtime.refresh(settings(), { resetMode: "always" });
  await empty.runtime.toggle({ context: "ctx" });
  assert.equal(empty.sent.at(-1).data, "Betis\nNo finished match");
  await empty.runtime.toggle({ context: "ctx" });
  assert.equal(empty.sent.at(-1).data, "Betis\nNo upcoming match");
  await empty.runtime.toggle({ context: "never-added" });
  assert.equal(empty.sent.at(-1).data, "Betis\nAdd token");
});

test("settings reset the view to nearest and establish a silent baseline", async () => {
  const alerts = [];
  const matches = [
    event({ id: "last", homeTeam: "Last Home", status: "FINISHED", kickoff: "2026-09-14T15:00:00Z" }),
    event({ id: "live", homeTeam: "Live Home", status: "IN_PLAY", kickoff: "2026-09-14T17:55:00Z", homeScore: 2, awayScore: 0 }),
  ];
  const h = harness({ matches, alert: () => alerts.push("play") });
  await h.runtime.refresh(settings(), { resetMode: "always" });
  await h.runtime.toggle({ context: "ctx" });
  assert.match(h.sent.at(-1).data, /Last Home/);
  matches[1] = event({ id: "live", homeTeam: "Live Home", status: "IN_PLAY", kickoff: "2026-09-14T17:55:00Z", homeScore: 3, awayScore: 0 });
  await h.runtime.refresh(settings(), { resetMode: "always" });
  assert.match(h.sent.at(-1).data, /Live Home/);
  assert.equal(h.rendered.at(-1).options.goalSide, null);
  assert.deepEqual(alerts, []);
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
  assert.equal(rendered.at(-1).options.assignedTeamSide, "home");
});

test("TeamRuntime derives the assigned side from the final enriched match identity", async () => {
  const listMatch = event({
    id: "42",
    status: "IN_PLAY",
    minute: null,
    homeTeamId: null,
    awayTeamId: 90,
  });
  const h = harness({
    matches: [listMatch],
    loadMatchDetail: async () => ({ ...listMatch, homeTeamId: 559, minute: 67 }),
  });

  await h.runtime.refresh(settings());

  assert.equal(h.rendered.at(-1).options.assignedTeamSide, "away");
});

test("TeamRuntime omits an ambiguous assigned side", async () => {
  const h = harness({ matches: [event({ homeTeamId: 90, awayTeamId: 90 })] });

  await h.runtime.refresh(settings());

  assert.equal(h.rendered.at(-1).options.assignedTeamSide, null);
});

test("TeamRuntime preserves the selected side through toggle navigation and background polling", async () => {
  const matches = [
    event({ id: "last", status: "FINISHED", kickoff: "2026-09-14T17:00:00Z", homeTeamId: 559, awayTeamId: 90 }),
    event({ id: "live", status: "IN_PLAY", kickoff: "2026-09-14T17:55:00Z", homeTeamId: 90, awayTeamId: 559 }),
  ];
  const h = harness({ matches });

  await h.runtime.refresh(settings(), { resetMode: "always" });
  assert.equal(h.rendered.at(-1).options.assignedTeamSide, "home");

  await h.runtime.toggle({ context: "ctx" });
  assert.equal(h.rendered.at(-1).options.assignedTeamSide, "away");

  await h.runtime.toggle({ context: "ctx" });
  assert.equal(h.rendered.at(-1).options.assignedTeamSide, "home");
  await h.timers.at(-1).callback();
  assert.equal(h.rendered.at(-1).options.assignedTeamSide, "home");
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

test("TeamRuntime requests detail only for a selected active match with no valid minute", async () => {
  for (const match of [
    event({ status: "TIMED", minute: null }),
    event({ status: "FINISHED", minute: null }),
    event({ status: "POSTPONED", minute: null }),
    event({ status: "IN_PLAY", minute: 0 }),
    event({ status: "PAUSED", minute: 45 }),
    event({ status: "LIVE", minute: 67 }),
  ]) {
    const h = harness({ matches: [match], loadMatchDetail: async () => ({ ...match, minute: 12 }) });
    await h.runtime.refresh(settings());
    assert.equal(h.detailCalls.length, 0, `${match.status}:${String(match.minute)}`);
  }

  const active = event({ id: "42", status: "IN_PLAY", minute: null });
  const h = harness({ matches: [active], loadMatchDetail: async () => ({ ...active, minute: 12 }) });
  await h.runtime.refresh(settings());
  assert.deepEqual(h.detailCalls, [["42", "t", "PD"]]);
});

test("valid detail replaces LIVE with its clock and score while preserving omitted list fields", async () => {
  const listMatch = event({
    id: "42",
    status: "IN_PLAY",
    minute: null,
    homeScore: 1,
    awayScore: 1,
    homeCrestUrl: "home-list",
    awayCrestUrl: "away-list",
  });
  const crestLoads = [];
  const h = harness({
    matches: [listMatch],
    loadMatchDetail: async () => ({
      id: "42",
      status: "IN_PLAY",
      minute: 67,
      injuryTime: 2,
      homeScore: 2,
      awayScore: 1,
      homeTeam: null,
      homeCrestUrl: null,
    }),
    loadCrest: async (url) => { crestLoads.push(url); return `crest:${url}`; },
  });

  await h.runtime.refresh(settings());

  assert.equal(h.rendered.at(-1).text, "Real Betis\nSevilla FC\n2 - 1\n2ND HALF 67+2'");
  assert.deepEqual(crestLoads, ["home-list", "away-list"]);
  assert.equal(h.timers.at(-1).delay, POLL_INTERVAL_MS);
});

test("unavailable, failed, malformed and mismatched detail estimate the active phase and keep polling", async () => {
  const listMatch = event({ id: "42", status: "IN_PLAY", minute: null, injuryTime: null, homeScore: 1, awayScore: 1, kickoff: "2026-09-14T17:30:00Z" });
  const cases = [
    { name: "unavailable" },
    { name: "failed", loadMatchDetail: async () => { throw new Error("detail failed"); } },
    { name: "malformed", loadMatchDetail: async () => ({ id: "42", minute: "67", homeScore: 9 }) },
    { name: "mismatched", loadMatchDetail: async () => ({ ...listMatch, id: "43", minute: 67, homeScore: 9 }) },
    { name: "unsupported status", loadMatchDetail: async () => ({ ...listMatch, status: "BOGUS", minute: 67, homeScore: 9 }) },
    { name: "conflicting identity", loadMatchDetail: async () => ({ ...listMatch, homeTeamId: 999, minute: 67, homeScore: 9 }) },
  ];

  for (const item of cases) {
    const h = harness({ matches: [listMatch], loadMatchDetail: item.loadMatchDetail });
    await h.runtime.refresh(settings());
    assert.equal(h.rendered.at(-1).text.split("\n").at(-1), "~1ST HALF 30'", item.name);
    assert.match(h.rendered.at(-1).text, /1 - 1/, item.name);
    assert.doesNotMatch(h.sent.at(-1).data, /Data unavailable/, item.name);
    assert.equal(h.timers.length, 1, item.name);
    assert.equal(h.timers[0].delay, POLL_INTERVAL_MS, item.name);
  }
});

test("same-ID unsupported status and conflicting teams reject the whole detail", async () => {
  const listMatch = event({ id: "42", status: "IN_PLAY", minute: null, homeScore: 1, awayScore: 1, kickoff: "2026-09-14T17:30:00Z" });
  const h = harness({
    matches: [listMatch],
    loadMatchDetail: async () => ({
      ...listMatch,
      status: "BOGUS",
      minute: 72,
      homeTeamId: 559,
      awayTeamId: 90,
      homeTeam: "Wrong Home",
      awayTeam: "Wrong Away",
      homeScore: 9,
      awayScore: 8,
    }),
  });

  await h.runtime.refresh(settings());

  assert.equal(h.rendered.at(-1).text, "Real Betis\nSevilla FC\n1 - 1\n~1ST HALF 30'");
  assert.equal(h.rendered.at(-1).options.live, true);
  assert.equal(h.rendered.at(-1).options.goalSide, null);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delay, POLL_INTERVAL_MS);
});

test("active detail transitions remain coherent for PAUSED and FINISHED", async () => {
  const pausedList = event({ id: "paused", status: "IN_PLAY", minute: null, homeScore: 1, awayScore: 0 });
  const paused = harness({
    matches: [pausedList],
    loadMatchDetail: async () => ({ ...pausedList, status: "PAUSED", minute: 45 }),
  });
  await paused.runtime.refresh(settings());
  assert.equal(paused.rendered.at(-1).text.split("\n").at(-1), "HALF TIME 45'");
  assert.equal(paused.rendered.at(-1).options.live, true);
  assert.equal(paused.timers.length, 1);
  assert.equal(paused.timers[0].delay, POLL_INTERVAL_MS);

  const alerts = [];
  let detailCall = 0;
  const finishedList = event({ id: "finished", status: "IN_PLAY", minute: null, homeScore: 1, awayScore: 0 });
  const finished = harness({
    matches: [finishedList],
    loadMatchDetail: async () => {
      detailCall += 1;
      return {
        ...finishedList,
        status: detailCall === 1 ? "IN_PLAY" : "FINISHED",
        minute: detailCall === 1 ? 89 : 90,
        homeScore: detailCall === 1 ? 1 : 2,
      };
    },
    alert: () => alerts.push("play"),
  });
  await finished.runtime.refresh(settings());
  const activeTimer = finished.timers[0];
  await finished.runtime.refresh(settings());
  assert.equal(finished.rendered.at(-1).text.split("\n").at(-1), "FINISHED");
  assert.equal(finished.rendered.at(-1).options.live, false);
  assert.deepEqual(alerts, []);
  assert.equal(finished.timers.length, 1, "FINISHED does not schedule a replacement poll");
  assert.ok(finished.cleared.includes(activeTimer));
});

test("a stale detail response cannot load crests, draw, alert, alter selection or schedule", async () => {
  let releaseDetail;
  const pendingDetail = new Promise((resolve) => { releaseDetail = resolve; });
  const alerts = [];
  const crestLoads = [];
  let listCall = 0;
  const h = harness({
    matches: () => {
      listCall += 1;
      return listCall === 1
        ? [event({ id: "live", status: "IN_PLAY", minute: null, homeScore: 0, awayScore: 0 })]
        : [event({ id: "finished", status: "FINISHED", kickoff: "2026-09-14T17:00:00Z" })];
    },
    loadMatchDetail: async () => pendingDetail,
    loadCrest: async (url) => { crestLoads.push(url); return url; },
    alert: () => alerts.push("play"),
  });
  const stale = h.runtime.refresh(settings());
  await new Promise((resolve) => setImmediate(resolve));
  await h.runtime.refresh(settings({ competition: "PL" }), { resetMode: "always" });
  const current = {
    sent: h.sent.length,
    rendered: h.rendered.length,
    timers: h.timers.length,
    crestLoads: crestLoads.length,
  };

  releaseDetail(event({ id: "live", status: "IN_PLAY", minute: 68, homeScore: 9, awayScore: 0 }));
  await stale;

  assert.deepEqual({
    sent: h.sent.length,
    rendered: h.rendered.length,
    timers: h.timers.length,
    crestLoads: crestLoads.length,
  }, current);
  assert.deepEqual(alerts, []);
  await h.runtime.toggle({ context: "ctx" });
  assert.equal(h.sent.at(-1).data, "Betis\nNo upcoming match", "the current selection and mode survived");
});

test("enriched scores establish a silent baseline and later enriched goals alert correctly", async () => {
  const alerts = [];
  let detailCall = 0;
  const listMatch = event({ id: "42", status: "IN_PLAY", minute: null, homeScore: 0, awayScore: 0 });
  const h = harness({
    matches: [listMatch],
    loadMatchDetail: async () => {
      detailCall += 1;
      return event({
        id: "42",
        status: "IN_PLAY",
        minute: 60 + detailCall,
        homeScore: detailCall === 1 ? 2 : 3,
        awayScore: 0,
      });
    },
    alert: () => alerts.push("play"),
  });

  await h.runtime.refresh(settings());
  assert.equal(h.rendered.at(-1).options.goalSide, null);
  assert.deepEqual(alerts, []);
  await h.runtime.refresh(settings());
  assert.equal(h.rendered.at(-1).options.goalSide, "home");
  assert.deepEqual(alerts, ["play"]);
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

test("score increases mark home, away or both for one successful refresh only", async () => {
  const sequence = [
    event({ status: "IN_PLAY", homeScore: 0, awayScore: 0 }),
    event({ status: "IN_PLAY", homeScore: 1, awayScore: 0 }),
    event({ status: "IN_PLAY", homeScore: 1, awayScore: 1 }),
    event({ status: "IN_PLAY", homeScore: 2, awayScore: 2 }),
    event({ status: "IN_PLAY", homeScore: 2, awayScore: 2 }),
    event({ status: "IN_PLAY", homeScore: 1, awayScore: 2 }),
  ];
  const h = harness({ matches: (call) => [sequence[call - 1]] });
  const sides = [];
  for (const _match of sequence) {
    await h.runtime.refresh(settings());
    sides.push(h.rendered.at(-1).options.goalSide);
  }
  assert.deepEqual(sides, [null, "home", "away", "both", null, null]);
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
  assert.deepEqual(
    h.rendered.filter(({ options }) => options).map(({ options }) => options.goalSide),
    [null, null, "home"],
  );
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

test("an active match polls once after exactly two minutes", async () => {
  const h = harness({ matches: [event({ status: "IN_PLAY" })] });
  await h.runtime.refresh(settings());
  assert.equal(POLL_INTERVAL_MS, 120000);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delay, 120000);
  await h.timers[0].callback();
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.length, 2, "the completed poll schedules one next one-shot timer");
});

test("automatic polling draws local remaining-time progress without provider or side effects", async () => {
  let nowMs = NOW.getTime();
  const crestLoads = [];
  const alerts = [];
  const h = harness({
    matches: (call) => [event({
      status: "IN_PLAY",
      minute: null,
      homeScore: call === 1 ? 0 : 1,
      awayScore: 0,
      kickoff: new Date(NOW.getTime() - 44 * 60000).toISOString(),
      homeCrestUrl: "home",
      awayCrestUrl: "away",
    })],
    now: () => new Date(nowMs),
    loadCrest: async (url) => { crestLoads.push(url); return `crest:${url}`; },
    alert: () => alerts.push("play"),
  });

  await h.runtime.refresh(settings());
  assert.equal(h.rendered[0].options, undefined, "initial loading does not expose progress");
  assert.equal(h.rendered.at(-1).options.refreshProgress, 1);
  assert.match(h.rendered.at(-1).text, /~1ST HALF 44'$/);
  assert.equal(h.progressTimers[0].delay, 1000);

  nowMs += POLL_INTERVAL_MS / 2;
  await h.progressTimers[0].callback();
  assert.equal(h.rendered.at(-1).options.refreshProgress, 0.5);
  assert.equal(h.rendered.at(-1).options.goalSide, null);
  assert.equal(h.rendered.at(-1).options.assignedTeamSide, "home");
  assert.match(h.rendered.at(-1).text, /~HALF TIME$/, "local redraws advance estimates from the injected clock");
  assert.equal(h.calls.length, 1, "progress redraws do not request match data");
  assert.deepEqual(crestLoads, ["home", "away"], "progress redraws reuse captured crests");
  assert.deepEqual(alerts, []);

  await h.runtime.refresh(settings());
  assert.deepEqual(alerts, ["play"], "progress redraws do not mutate the score baseline");
});

test("only an actual automatic poll exposes refresh progress", async () => {
  const terminal = harness({ matches: [event({ status: "FINISHED" })] });
  await terminal.runtime.refresh(settings());
  assert.equal(terminal.rendered.at(-1).options.refreshProgress, undefined);
  assert.equal(terminal.progressTimers.length, 0);

  const future = harness({ matches: [event({
    status: "TIMED",
    kickoff: new Date(NOW.getTime() + 60000).toISOString(),
    homeScore: null,
    awayScore: null,
  })] });
  await future.runtime.refresh(settings());
  assert.equal(future.rendered.at(-1).options.refreshProgress, undefined);
  assert.equal(future.progressTimers.length, 0);

  const modes = harness({ matches: [
    event({ id: "last", status: "FINISHED", kickoff: "2026-09-14T17:00:00Z" }),
    event({ id: "live", status: "IN_PLAY", kickoff: "2026-09-14T17:55:00Z" }),
  ] });
  await modes.runtime.refresh(settings(), { resetMode: "always" });
  await modes.runtime.toggle({ context: "ctx" });
  assert.equal(modes.rendered.at(-1).options.refreshProgress, undefined);
  assert.equal(modes.progressTimers.length, 1, "last mode does not schedule progress");
});

test("progress cancellation and stale callbacks cannot draw or request data", async () => {
  const cases = [
    ["manual replacement", async (h) => h.runtime.refresh(settings({ competition: "PL" }))],
    ["clear", async (h) => h.runtime.clear({ param: [{ context: "ctx" }] })],
    ["dispose", async (h) => h.runtime.dispose()],
  ];

  for (const [name, cancel] of cases) {
    const h = harness({ matches: (call) => [event({ status: call === 1 ? "IN_PLAY" : "FINISHED", minute: 60 })] });
    await h.runtime.refresh(settings());
    const progressTimer = h.progressTimers[0];
    await cancel(h);
    const state = { calls: h.calls.length, rendered: h.rendered.length };
    await progressTimer.callback();
    assert.deepEqual({ calls: h.calls.length, rendered: h.rendered.length }, state, name);
    assert.ok(h.progressCleared.includes(progressTimer), name);
  }
});

test("the deadline performs one provider refresh while the progress timer remains local", async () => {
  let nowMs = NOW.getTime();
  const h = harness({ matches: [event({ status: "IN_PLAY", minute: 60 })], now: () => new Date(nowMs) });
  await h.runtime.refresh(settings());
  const pollTimer = h.timers[0];
  const progressTimer = h.progressTimers[0];
  const renderedBeforeDeadline = h.rendered.length;

  nowMs += POLL_INTERVAL_MS;
  await progressTimer.callback();
  assert.equal(h.calls.length, 1);
  assert.equal(h.rendered.length, renderedBeforeDeadline);

  await pollTimer.callback();
  assert.equal(h.calls.length, 2, "the poll timer owns the only deadline request");
});

test("a local countdown tick redraws captured data without API, crest, audio or baseline work", async () => {
  let nowMs = new Date(2026, 8, 14, 12).getTime();
  const kickoffMs = nowMs + 2 * 60000 + 1000;
  const crestLoads = [];
  const alerts = [];
  const scheduled = event({
    status: "TIMED",
    kickoff: new Date(kickoffMs).toISOString(),
    homeScore: 0,
    awayScore: 0,
    homeCrestUrl: "home",
    awayCrestUrl: "away",
  });
  const live = event({ ...scheduled, status: "LIVE", homeScore: 1, awayScore: 0 });
  const h = harness({
    matches: (call) => [call === 1 ? scheduled : live],
    now: () => new Date(nowMs),
    alert: () => alerts.push("play"),
    loadCrest: async (url) => { crestLoads.push(url); return `crest:${url}`; },
  });
  await h.runtime.refresh(settings());
  assert.match(h.rendered.at(-1).text, /START IN 00:03$/);

  nowMs += 1000;
  await h.timers[0].callback();
  assert.match(h.rendered.at(-1).text, /START IN 00:02$/);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(crestLoads, ["home", "away"]);
  assert.deepEqual(alerts, []);
  assert.deepEqual(h.rendered.at(-1).options, {
    homeCrest: "crest:home",
    awayCrest: "crest:away",
    assignedTeamSide: "home",
    live: false,
    goalSide: null,
  });

  nowMs = kickoffMs;
  await h.timers[1].callback();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(alerts, ["play"], "the local tick did not replace the score baseline");
});

test("a local countdown redraw removes an ephemeral goal marker", async () => {
  let nowMs = new Date(2026, 8, 14, 12).getTime();
  const kickoffMs = nowMs + 2 * 60000 + 1000;
  const sequence = [
    event({ status: "TIMED", kickoff: new Date(kickoffMs).toISOString(), homeScore: 0, awayScore: 0 }),
    event({ status: "TIMED", kickoff: new Date(kickoffMs).toISOString(), homeScore: 1, awayScore: 0 }),
  ];
  const h = harness({ matches: (call) => [sequence[Math.min(call - 1, 1)]], now: () => new Date(nowMs) });
  await h.runtime.refresh(settings());
  await h.runtime.refresh(settings());
  assert.equal(h.rendered.at(-1).options.goalSide, "home");

  nowMs += 1000;
  await h.timers.at(-1).callback();
  assert.equal(h.rendered.at(-1).options.goalSide, null);
  assert.equal(h.rendered.at(-1).options.live, false);
  assert.equal(h.calls.length, 2);
});

test("local midnight activates the countdown without an API request", async () => {
  let nowMs = new Date(2026, 8, 14, 23, 59, 50).getTime();
  const kickoff = new Date(2026, 8, 15, 0, 10);
  const match = event({ status: "TIMED", kickoff: kickoff.toISOString(), homeScore: null, awayScore: null });
  const h = harness({ matches: [match], now: () => new Date(nowMs) });
  await h.runtime.refresh(settings());
  assert.equal(h.rendered.at(-1).text.split("\n").at(-1), kickoff.toLocaleDateString());
  assert.equal(h.timers[0].delay, 10000);

  nowMs = new Date(2026, 8, 15).getTime();
  await h.timers[0].callback();
  assert.equal(h.calls.length, 1);
  assert.equal(h.rendered.at(-1).text.split("\n").at(-1), "START IN 00:10");
});

test("a future scheduled match wakes exactly at kickoff without an earlier API call", async () => {
  let reference = new Date(NOW);
  const kickoff = new Date(NOW.getTime() + 1000);
  const h = harness({
    matches: [event({ status: "TIMED", kickoff: kickoff.toISOString(), homeScore: null, awayScore: null })],
    now: () => new Date(reference),
  });
  await h.runtime.refresh(settings());
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delay, kickoff.getTime() - NOW.getTime());
  assert.equal(h.calls.length, 1, "arming the local wakeup makes no provider call");

  reference = kickoff;
  await h.timers[0].callback();
  assert.equal(h.calls.length, 2, "kickoff wakeup makes exactly one background request");
  assert.equal(h.timers.length, 2);
  assert.equal(h.timers[1].delay, POLL_INTERVAL_MS, "lagging TIMED status enters the two-minute cadence");
  assert.equal(h.sent.filter(({ data }) => /Loading…/.test(data)).length, 1, "the kickoff request stays background");
});

test("background discards a postponed retained match and selects an alternative live match", async () => {
  let reference = new Date(NOW);
  const kickoff = new Date(NOW.getTime() + 60000);
  const scheduled = event({ id: "same", homeTeam: "Scheduled", status: "TIMED", kickoff: kickoff.toISOString(), homeScore: null, awayScore: null });
  const postponed = event({ ...scheduled, homeTeam: "Postponed", status: "POSTPONED" });
  const live = event({ id: "live", homeTeam: "Alternative Live", status: "IN_PLAY", kickoff: NOW.toISOString(), homeScore: 3, awayScore: 1 });
  const alerts = [];
  const h = harness({
    matches: (call) => call === 1 ? [scheduled] : [postponed, live],
    now: () => new Date(reference),
    alert: () => alerts.push("play"),
  });
  await h.runtime.refresh(settings());
  reference = kickoff;
  await h.timers[0].callback();

  assert.match(h.sent.at(-1).data, /Alternative Live/);
  assert.equal(h.rendered.at(-1).options.goalSide, null, "the replacement match starts a silent baseline");
  assert.deepEqual(alerts, []);
  assert.equal(h.timers[1].delay, POLL_INTERVAL_MS);
});

test("background discards a finished retained match and wakes for the next future match", async () => {
  let reference = new Date(NOW);
  const kickoff = new Date(NOW.getTime() + 60000);
  const nextKickoff = new Date(NOW.getTime() + 10 * 60000);
  const scheduled = event({ id: "same", homeTeam: "Scheduled", status: "TIMED", kickoff: kickoff.toISOString(), homeScore: null, awayScore: null });
  const finished = event({ ...scheduled, homeTeam: "Finished", status: "FINISHED", homeScore: 2, awayScore: 0 });
  const future = event({ id: "future", homeTeam: "Future", status: "TIMED", kickoff: nextKickoff.toISOString(), homeScore: null, awayScore: null });
  const alerts = [];
  const h = harness({
    matches: (call) => call === 1 ? [scheduled] : [finished, future],
    now: () => new Date(reference),
    alert: () => alerts.push("play"),
  });
  await h.runtime.refresh(settings());
  reference = kickoff;
  await h.timers[0].callback();

  assert.match(h.sent.at(-1).data, /Future/);
  assert.equal(h.rendered.at(-1).options.goalSide, null);
  assert.deepEqual(alerts, []);
  assert.equal(h.timers[1].delay, 60000, "the next countdown minute owns the single timer");
});

test("invalid or foreign retained matches fall back to the bounded next message without a timer", async () => {
  const kickoff = new Date(NOW.getTime() + 60000);
  const scheduled = event({ id: "same", status: "TIMED", kickoff: kickoff.toISOString(), homeScore: null, awayScore: null });
  const cases = [
    event({ ...scheduled, kickoff: "invalid" }),
    event({ ...scheduled, status: "LIVE", homeTeamId: 1, awayTeamId: 2 }),
  ];
  for (const invalid of cases) {
    let reference = new Date(NOW);
    const h = harness({ matches: (call) => call === 1 ? [scheduled] : [invalid], now: () => new Date(reference) });
    await h.runtime.refresh(settings());
    reference = kickoff;
    await h.timers[0].callback();
    assert.equal(h.sent.at(-1).data, "Betis\nNo upcoming match");
    assert.equal(h.timers.length, 1, "no orphan replacement timer is armed");
  }
});

test("a retained future match becoming live preserves its score baseline", async () => {
  let reference = new Date(NOW);
  const kickoff = new Date(NOW.getTime() + 60000);
  const scheduled = event({ id: "same", status: "TIMED", kickoff: kickoff.toISOString(), homeScore: null, awayScore: null });
  const live = event({ ...scheduled, status: "LIVE", homeScore: 1, awayScore: 0 });
  const alerts = [];
  const h = harness({
    matches: (call) => call === 1 ? [scheduled] : [live],
    now: () => new Date(reference),
    alert: () => alerts.push("play"),
  });
  await h.runtime.refresh(settings());
  reference = kickoff;
  await h.timers[0].callback();

  assert.equal(h.rendered.at(-1).options.goalSide, "home");
  assert.deepEqual(alerts, ["play"]);
  assert.equal(h.timers[1].delay, POLL_INTERVAL_MS);
});

test("a scheduled match whose kickoff passed polls in two minutes", async () => {
  const h = harness({ matches: [event({ status: "SCHEDULED", kickoff: "2026-09-14T17:59:00Z", homeScore: null, awayScore: null })] });
  await h.runtime.refresh(settings());
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delay, POLL_INTERVAL_MS);
});

test("last mode never polls while next mode and its polling refresh retain that mode", async () => {
  const matches = [
    event({ id: "last", homeTeam: "Last Home", status: "FINISHED", kickoff: "2026-09-14T17:00:00Z" }),
    event({ id: "next", homeTeam: "Next Home", status: "IN_PLAY", kickoff: "2026-09-14T17:55:00Z" }),
  ];
  const h = harness({ matches });
  await h.runtime.refresh(settings(), { resetMode: "always" });
  assert.equal(h.timers.length, 1, "nearest selects the active fixture");

  await h.runtime.toggle({ context: "ctx" });
  assert.match(h.sent.at(-1).data, /Last Home/);
  assert.equal(h.timers.length, 1, "last view does not create a timer");

  await h.runtime.toggle({ context: "ctx" });
  assert.match(h.sent.at(-1).data, /Next Home/);
  assert.equal(h.timers.length, 2);
  await h.timers.at(-1).callback();
  assert.match(h.sent.at(-1).data, /Next Home/);
  assert.equal(h.timers.length, 3, "polling retains next mode and schedules its successor");
});

test("automatic polling preserves the current image until it emits only the successful update", async () => {
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

test("automatic polling replaces the current image with Data unavailable on error", async () => {
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
    progressTimers: h.progressTimers.length,
  };

  resolvePoll([event({ status: "IN_PLAY", homeScore: 1, awayScore: 0 })]);
  await stalePoll;

  assert.deepEqual(
    { sent: h.sent.length, alerts: alerts.length, timers: h.timers.length, progressTimers: h.progressTimers.length },
    stateAfterForeground,
  );
  await h.runtime.refresh(settings());
  assert.equal(alerts.length, stateAfterForeground.alerts, "the stale score never became the baseline");
});

test("a stale toggle response cannot restore its mode, selection, marker, audio or timer", async () => {
  let resolveToggle;
  const slowToggle = new Promise((resolve) => { resolveToggle = resolve; });
  const live = event({ id: "live", homeTeam: "Live Home", status: "IN_PLAY", kickoff: "2026-09-14T17:55:00Z", homeScore: 0, awayScore: 0 });
  const finished = event({ id: "last", homeTeam: "Stale Last", status: "FINISHED", kickoff: "2026-09-14T17:00:00Z", homeScore: 4, awayScore: 0 });
  const alerts = [];
  const h = harness({
    matches: (call) => call === 1 ? [live] : call === 2 ? slowToggle : call === 3 ? [live] : [finished, live],
    alert: () => alerts.push("play"),
  });
  await h.runtime.refresh(settings(), { resetMode: "always" });
  const stale = h.runtime.toggle({ context: "ctx" });
  await new Promise((resolve) => setImmediate(resolve));
  await h.runtime.refresh(settings(), { resetMode: "always" });
  const current = { sent: h.sent.length, rendered: h.rendered.length, timers: h.timers.length };

  resolveToggle([finished]);
  await stale;
  assert.deepEqual({ sent: h.sent.length, rendered: h.rendered.length, timers: h.timers.length }, current);
  assert.deepEqual(alerts, []);
  assert.equal(h.rendered.at(-1).options.goalSide, null);

  await h.runtime.toggle({ context: "ctx" });
  assert.match(h.sent.at(-1).data, /Stale Last/, "settings reset survived, so the next press selects last");
  assert.equal(h.timers.length, current.timers, "the finished last view creates no timer");
});

test("terminal and postponed matches never schedule timers", async () => {
  for (const status of ["FINISHED", "CANCELLED", "POSTPONED", "SUSPENDED", "AWARDED"]) {
    const terminal = harness({ matches: [event({ status })] });
    await terminal.runtime.refresh(settings());
    assert.equal(terminal.timers.length, 0, status);
  }
});

test("IN_PLAY, PAUSED and LIVE poll regardless of the local calendar day", async () => {
  const reference = new Date(2026, 8, 14, 23, 55);
  const afterMidnight = new Date(2026, 8, 15, 0, 5).toISOString();
  for (const status of ["IN_PLAY", "PAUSED", "LIVE"]) {
    const h = harness({ matches: [event({ status, kickoff: afterMidnight })], now: () => reference });
    await h.runtime.refresh(settings());
    assert.equal(h.timers.length, 1, `${status} remains authoritative across midnight`);
    assert.equal(h.timers[0].delay, POLL_INTERVAL_MS);
  }
});

test("a local wake target beyond the timeout cap is chunked without API calls", async () => {
  let nowMs = new Date(2026, 8, 14, 12).getTime();
  const kickoffMs = new Date(2026, 8, 15, 12).getTime();
  const timeoutCap = 5000;
  const match = event({ status: "TIMED", kickoff: new Date(kickoffMs).toISOString(), homeScore: null, awayScore: null });
  const h = harness({ matches: [match], now: () => new Date(nowMs), maxTimeout: timeoutCap });
  await h.runtime.refresh(settings());
  assert.equal(h.calls.length, 1);
  assert.equal(MAX_TIMEOUT_MS, 0x7fffffff);
  assert.equal(h.timers[0].delay, timeoutCap);

  nowMs += timeoutCap;
  await h.timers[0].callback();
  assert.equal(h.calls.length, 1, "safe chunk rearming stays local");
  assert.equal(h.timers[1].delay, timeoutCap);
  assert.equal(h.rendered.length, 2, "timeout chunks do not redraw before the display boundary");
});

test("mode, settings, selection, clear and dispose invalidate stale local wakeups", async () => {
  const kickoff = new Date(NOW.getTime() + 121000).toISOString();
  const future = event({ id: "future", status: "TIMED", kickoff, homeScore: null, awayScore: null });
  const finished = event({ id: "last", status: "FINISHED", kickoff: "2026-09-14T17:00:00Z" });

  const mode = harness({ matches: [future, finished] });
  await mode.runtime.refresh(settings());
  const modeWake = mode.timers[0];
  await mode.runtime.toggle({ context: "ctx" });
  const modeCalls = mode.calls.length;
  await modeWake.callback();
  assert.equal(mode.calls.length, modeCalls);
  assert.ok(mode.cleared.includes(modeWake));

  const reset = harness({ matches: [future] });
  await reset.runtime.refresh(settings());
  const resetWake = reset.timers[0];
  await reset.runtime.refresh(settings(), { resetMode: "always" });
  const resetState = { calls: reset.calls.length, rendered: reset.rendered.length, timers: reset.timers.length };
  await resetWake.callback();
  assert.deepEqual({ calls: reset.calls.length, rendered: reset.rendered.length, timers: reset.timers.length }, resetState);
  assert.ok(reset.cleared.includes(resetWake));

  const selection = harness({ matches: [future] });
  await selection.runtime.refresh(settings());
  const selectionWake = selection.timers[0];
  await selection.runtime.refresh(settings({ competition: "PL" }));
  const selectionCalls = selection.calls.length;
  await selectionWake.callback();
  assert.equal(selection.calls.length, selectionCalls);
  assert.ok(selection.cleared.includes(selectionWake));

  for (const action of ["clear", "dispose"]) {
    const h = harness({ matches: [future] });
    await h.runtime.refresh(settings());
    const wake = h.timers[0];
    if (action === "clear") h.runtime.clear({ param: [{ context: "ctx" }] });
    else h.runtime.dispose();
    const calls = h.calls.length;
    await wake.callback();
    assert.equal(h.calls.length, calls, action);
    assert.ok(h.cleared.includes(wake), action);
  }
});

test("a late wakeup after computer suspension refreshes once and resumes polling", async () => {
  let nowMs = NOW.getTime();
  const kickoffMs = nowMs + 60000;
  const match = event({ status: "TIMED", kickoff: new Date(kickoffMs).toISOString(), homeScore: null, awayScore: null });
  const h = harness({ matches: [match], now: () => new Date(nowMs) });
  await h.runtime.refresh(settings());
  const wake = h.timers[0];

  nowMs = kickoffMs + 60 * 60 * 1000;
  await wake.callback();
  assert.equal(h.calls.length, 2, "a delayed callback performs one provider request");
  assert.equal(h.rendered.at(-2).text.split("\n").at(-1), "START IN 00:00", "the late local redraw clamps at zero");
  assert.equal(h.timers.length, 2);
  assert.equal(h.timers[1].delay, POLL_INTERVAL_MS);
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
