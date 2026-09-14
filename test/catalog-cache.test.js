"use strict";

// The catalog cache is persisted so a key does not spend a request every time the
// plugin restarts, and it is only rewritten on an explicit refresh from the user.
//
// The raw API token is never written to disk: the cache key is a hash of it, which
// is enough to tell two tokens apart without storing the secret itself.

const assert = require("node:assert/strict");
const test = require("node:test");

const crypto = require("node:crypto");

const { CatalogCache } = require("../src/plugin/catalog-cache.js");

// Independent test-side hash: deterministic, and it cannot contain the token text,
// so the "no secret on disk" assertion below is meaningful.
const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");

function memoryFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  const ops = [];
  return {
    files,
    ops,
    readFile: (path) => { ops.push(["read", path]); return files.has(path) ? files.get(path) : null; },
    writeFile: (path, data) => { ops.push(["write", path]); files.set(path, data); },
    rename: (from, to) => { ops.push(["rename", from, to]); files.set(to, files.get(from)); files.delete(from); },
    remove: (path) => { ops.push(["remove", path]); files.delete(path); },
  };
}

const COMPETITIONS = [{ code: "PD", name: "Primera Division" }];

test("stores competitions under a token hash and never the raw token", () => {
  const fs = memoryFs();
  const cache = new CatalogCache({ fs, filePath: "catalog.json", hash });
  cache.saveCompetitions("secret-token", COMPETITIONS);
  const written = fs.files.get("catalog.json");
  assert.doesNotMatch(written, /secret-token/, "the raw token must never reach the disk");
  assert.deepEqual(cache.loadCompetitions("secret-token"), COMPETITIONS);
  assert.equal(cache.loadCompetitions("other-token"), null);
});

test("stores teams per competition and keeps competitions and teams independent", () => {
  const fs = memoryFs();
  const cache = new CatalogCache({ fs, filePath: "catalog.json", hash });
  cache.saveCompetitions("t", COMPETITIONS);
  cache.saveTeams("t", "PD", [{ id: 90, name: "Real Betis" }]);
  cache.saveTeams("t", "PL", [{ id: 57, name: "Arsenal" }]);
  assert.deepEqual(cache.loadTeams("t", "PD"), [{ id: 90, name: "Real Betis" }]);
  assert.deepEqual(cache.loadTeams("t", "PL"), [{ id: 57, name: "Arsenal" }]);
  assert.deepEqual(cache.loadCompetitions("t"), COMPETITIONS);
  assert.equal(cache.loadTeams("t", "SA"), null);
});

test("writes atomically through a temporary file and removes it on success", () => {
  const fs = memoryFs();
  const cache = new CatalogCache({ fs, filePath: "catalog.json", hash });
  cache.saveCompetitions("t", COMPETITIONS);
  const writes = fs.ops.filter(([op]) => op === "write").map(([, path]) => path);
  assert.ok(writes.some((path) => path.endsWith(".tmp")), JSON.stringify(writes));
  assert.ok(fs.ops.some(([op]) => op === "rename"));
  assert.equal(fs.files.has("catalog.json.tmp"), false, "the temporary file never survives");
});

test("treats a corrupt, absent or foreign cache file as empty instead of failing", () => {

  for (const initial of [{}, { "catalog.json": "not json" }, { "catalog.json": "[]" }, { "catalog.json": '{"schema":"other"}' }]) {
    const cache = new CatalogCache({ fs: memoryFs(initial), filePath: "catalog.json", hash });
    assert.equal(cache.loadCompetitions("t"), null, JSON.stringify(initial));
    assert.equal(cache.loadTeams("t", "PD"), null, JSON.stringify(initial));
  }
});

test("a write failure is contained: the cache degrades instead of breaking the key", () => {
  const fs = memoryFs();
  fs.writeFile = () => { throw new Error("read-only plugin folder"); };
  const cache = new CatalogCache({ fs, filePath: "catalog.json", hash });
  assert.doesNotThrow(() => cache.saveCompetitions("t", COMPETITIONS));
  assert.equal(cache.loadCompetitions("t"), null);
});
