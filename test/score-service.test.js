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
