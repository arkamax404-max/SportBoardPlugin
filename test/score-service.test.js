"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ScoreService } = require("../src/plugin/score-service.js");

test("ScoreService delegates match and selector operations", async () => {
  const calls = [];
  const provider = {
    listMatches: async (...args) => { calls.push(["matches", ...args]); return [{ id: "1" }]; },
    listCompetitions: async (token) => { calls.push(["competitions", token]); return [{ code: "PD", name: "Primera Division" }]; },
    listTeams: async (token, competition) => { calls.push(["teams", token, competition]); return [{ id: 90, name: "Real Betis" }]; },
  };
  const service = new ScoreService({ provider });
  const now = new Date("2026-09-14T18:00:00Z");
  assert.deepEqual(await service.listMatches(90, "t", "PD", now), [{ id: "1" }]);
  assert.deepEqual(await service.listCompetitions("t"), [{ code: "PD", name: "Primera Division" }]);
  assert.deepEqual(await service.listTeams("t", "PD"), [{ id: 90, name: "Real Betis" }]);
  assert.deepEqual(calls, [["matches", 90, "t", "PD", now], ["competitions", "t"], ["teams", "t", "PD"]]);
});

test("ScoreService rejects an incomplete provider", () => {
  assert.throws(() => new ScoreService({}), /must implement/);
  assert.throws(() => new ScoreService({ provider: { listMatches: async () => [] } }), /must implement/);
  assert.throws(() => new ScoreService({ provider: { listMatches: async () => [], listCompetitions: async () => [] } }), /must implement/);
  assert.doesNotThrow(() => new ScoreService({ provider: {
    listMatches: async () => [], listCompetitions: async () => [], listTeams: async () => [],
  } }));
});

test("ScoreService exposes optional match detail loading with a safe unavailable result", async () => {
  const required = {
    listMatches: async () => [],
    listCompetitions: async () => [],
    listTeams: async () => [],
  };
  const unavailable = new ScoreService({ provider: required });
  assert.equal(await unavailable.loadMatchDetail("1", "t", "PD"), null);

  const calls = [];
  const available = new ScoreService({ provider: {
    ...required,
    loadMatchDetail: async (...args) => { calls.push(args); return { id: "1", minute: 12 }; },
  } });
  assert.deepEqual(await available.loadMatchDetail("1", "t", "PD"), { id: "1", minute: 12 });
  assert.deepEqual(calls, [["1", "t", "PD"]]);
});
