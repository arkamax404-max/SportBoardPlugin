"use strict";

// End-to-end wiring test for the selector data path with the real composition
// (start()) and only the socket, the HTTP client and the cache path stubbed. Every
// failure this suite has caught so far lived in the wiring rather than in a unit, so
// the message names, the routing and the cache are asserted from the outside.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const EventEmitter = require("node:events");
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const os = require("node:os");

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.sportboard";
const ACTION_UUID = `${PLUGIN_UUID}.status`;
const VALID_ARGV = ["node", "dist/main.js", "127.0.0.1", "39069", "en"];

function createFakeSocket(recorder) {
  const socket = new EventEmitter();
  socket.writable = true;
  socket.destroyed = false;
  socket.write = (data) => { recorder.rawWrites.push(data); return true; };
  socket.destroy = () => { socket.destroyed = true; socket.writable = false; socket.emit("close"); };
  return socket;
}

function outboundPayloads(recorder) {
  return recorder.rawWrites.slice(1).map((buffer) => {
    const declared = buffer[1] & 0x7f;
    const header = declared === 126 ? 4 : declared === 127 ? 10 : 2;
    const mask = buffer.subarray(header, header + 4);
    const payload = Buffer.from(buffer.subarray(header + 4));
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    return JSON.parse(payload.toString("utf8"));
  });
}

function serverTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

function completeUpgrade(recorder, socket) {
  const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(recorder.rawWrites[0].toString("utf8"))[1];
  const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.emit("data", Buffer.from(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    "utf8",
  ));
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

// The plugin answers on socket writes, so a short drain between phases is what makes
// the sequence deterministic without reaching into the composition.
function drain() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

// The selectors are the competitions list and the team lists; the match query for
// the key itself is a separate concern and is not counted here.
function selectorCalls(calls) {
  return calls
    .filter((url) => !url.includes("/matches"))
    .map((url) => (url.endsWith("/competitions") ? "competitions" : "teams"));
}

function pushes(recorder) {
  return outboundPayloads(recorder).filter((payload) => payload.cmd === "sendToPropertyInspector");
}

function startSession({ fetch, cachePath }) {
  const main = require("../src/plugin/main.js");
  const recorder = { rawWrites: [], connects: [] };
  const socket = createFakeSocket(recorder);
  const status = main.start({
    argv: VALID_ARGV,
    connect: (endpoint) => { recorder.connects.push(endpoint); return socket; },
    randomBytes: (size) => Buffer.alloc(size, 0xcd),
    stderr: () => {},
    fetch,
    cachePath,
  });
  socket.emit("connect");
  completeUpgrade(recorder, socket);
  return { status, recorder, socket };
}

// The two inbound channels use different field names: saved settings arrive in
// `param` (paramfromplugin) while inspector requests arrive in `payload`
// (sendToPlugin). Using the wrong one is a silent no-op, so both are pinned here.
function settingsFrame(cmd, param) {
  return serverTextFrame(JSON.stringify({
    cmd, uuid: ACTION_UUID, key: "K1", actionid: ACTION_UUID, param,
  }));
}

function requestFrame(cmd, payload) {
  return serverTextFrame(JSON.stringify({
    cmd, uuid: ACTION_UUID, key: "K1", actionid: ACTION_UUID, payload,
  }));
}

function savedSettingsFrame(settings) {
  return serverTextFrame(JSON.stringify({
    cmd: "didReceiveSettings", uuid: ACTION_UUID, key: "K1", actionid: ACTION_UUID, settings,
  }));
}

test("durably saved settings populate the cache, selectors and key", async () => {
  const root = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sportboard-cache-"));
  try {
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      if (url.endsWith("/competitions")) return jsonResponse({ competitions: [{ code: "PD", name: "Primera Division", type: "LEAGUE" }] });
      if (/\/competitions\/[^/]+\/teams$/.test(url)) return jsonResponse({ teams: [{ id: 90, name: "Real Betis Balompié", shortName: "Real Betis" }] });
      return jsonResponse({ matches: [] });
    };
    const { status, recorder, socket } = startSession({ fetch, cachePath: nodePath.join(root, "catalog-cache.json") });
    assert.equal(status, 0);

    socket.emit("data", savedSettingsFrame({ token: "apikey-9f3b-secret", competition: "PD", teamId: "90" }));
    await drain();

    const pushed = pushes(recorder);
    assert.equal(pushed.length, 2, "competitions and teams are both pushed");
    assert.deepEqual(pushed[0].payload, { competitions: [{ code: "PD", name: "Primera Division" }] });
    assert.deepEqual(pushed[1].payload, { teams: [{ id: 90, name: "Real Betis" }], competition: "PD" });
    // The reply must address the key's own context or the host drops it.
    assert.equal(pushed[0].uuid, ACTION_UUID);
    assert.equal(pushed[0].key, "K1");
    assert.equal(pushed[0].actionid, ACTION_UUID);

    const cache = JSON.parse(nodeFs.readFileSync(nodePath.join(root, "catalog-cache.json"), "utf8"));
    assert.deepEqual(cache.tokens[Object.keys(cache.tokens)[0]].competitions, [{ code: "PD", name: "Primera Division" }]);
    assert.ok(!JSON.stringify(cache).includes("apikey-9f3b-secret"), "the raw token is never cached");
    assert.match(JSON.stringify(cache), /[0-9a-f]{64}/, "the cache is keyed by a token hash");
  } finally {
    nodeFs.rmSync(root, { recursive: true, force: true });
  }
});

test("a plugin restart repopulates the selectors and redraws the key from the add event", async () => {
  const root = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sportboard-cache-"));
  const cachePath = nodePath.join(root, "catalog-cache.json");
  try {
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      if (url.endsWith("/competitions")) return jsonResponse({ competitions: [{ code: "PD", name: "Primera Division", type: "LEAGUE" }] });
      if (/\/competitions\/[^/]+\/teams$/.test(url)) return jsonResponse({ teams: [{ id: 90, name: "Real Betis" }] });
      return jsonResponse({ matches: [{ id: 1, utcDate: "2026-09-04T19:00:00Z", status: "FINISHED", matchday: 4,
        homeTeam: { id: 90, name: "Real Betis Balompié", shortName: "Real Betis" },
        awayTeam: { id: 86, name: "Real Madrid CF", shortName: "Real Madrid" },
        score: { fullTime: { home: 1, away: 0 } } }] });
    };
    const { recorder, socket } = startSession({ fetch, cachePath });

    // The add event carries the saved settings, exactly as a fresh plugin start sees them.
    socket.emit("data", serverTextFrame(JSON.stringify({
      cmd: "add", uuid: ACTION_UUID, key: "K1", actionid: ACTION_UUID,
      param: { token: "apikey-9f3b-secret", competition: "PD", teamId: 90 },
    })));
    await drain();

    const pushed = pushes(recorder);
    assert.deepEqual(pushed[0].payload, { competitions: [{ code: "PD", name: "Primera Division" }] });
    assert.deepEqual(pushed[1].payload, { teams: [{ id: 90, name: "Real Betis" }], competition: "PD" });
    const images = outboundPayloads(recorder).filter((payload) => payload.cmd === "state" && payload.param?.statelist?.[0]?.type === 1);
    const svg = Buffer.from(images.at(-1).param.statelist[0].data.split(",")[1], "base64").toString("utf8");
    assert.match(svg, /Real Betis/);
    assert.match(svg, /1 - 0/);
  } finally {
    nodeFs.rmSync(root, { recursive: true, force: true });
  }
});

test("an inspector sync request republishes the cached lists without spending a request", async () => {
  const root = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sportboard-cache-"));
  const cachePath = nodePath.join(root, "catalog-cache.json");
  try {
    const warmCalls = [];
    const warmFetch = async (url) => {
      warmCalls.push(url);
      if (url.endsWith("/competitions")) return jsonResponse({ competitions: [{ code: "PD", name: "Primera Division", type: "LEAGUE" }] });
      if (/\/competitions\/[^/]+\/teams$/.test(url)) return jsonResponse({ teams: [{ id: 90, name: "Real Betis" }] });
      return jsonResponse({ matches: [] });
    };
    const warm = startSession({ fetch: warmFetch, cachePath });
    warm.socket.emit("data", settingsFrame("paramfromplugin", { token: "apikey-9f3b-secret", competition: "PD" }));
    await drain();

    const coldCalls = [];
    const coldFetch = async (url) => { coldCalls.push(url); return jsonResponse({ competitions: [], teams: [], matches: [] }); };
    const cold = startSession({ fetch: coldFetch, cachePath });
    cold.socket.emit("data", requestFrame("sendToPlugin", { token: "apikey-9f3b-secret", competition: "PD", sync: true }));
    await drain();

    assert.deepEqual(selectorCalls(coldCalls), [], "a warm cache answers the sync without a provider request");
    assert.deepEqual(pushes(cold.recorder)[0].payload, { competitions: [{ code: "PD", name: "Primera Division" }] });
    assert.deepEqual(pushes(cold.recorder)[1].payload, { teams: [{ id: 90, name: "Real Betis" }], competition: "PD" });
  } finally {
    nodeFs.rmSync(root, { recursive: true, force: true });
  }
});

test("a cached session spends no provider request, and refresh reloads on demand", async () => {
  const root = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "sportboard-cache-"));
  const cachePath = nodePath.join(root, "catalog-cache.json");
  try {
    const firstCalls = [];
    const firstFetch = async (url) => {
      firstCalls.push(url);
      if (url.endsWith("/competitions")) return jsonResponse({ competitions: [{ code: "PD", name: "Primera Division", type: "LEAGUE" }] });
      return jsonResponse({ teams: [{ id: 90, name: "Real Betis" }] });
    };
    const first = startSession({ fetch: firstFetch, cachePath });
    first.socket.emit("data", settingsFrame("paramfromplugin", { token: "apikey-9f3b-secret", competition: "PD" }));
    await drain();
    assert.deepEqual(selectorCalls(firstCalls), ["competitions", "teams"]);

    // A second session (a plugin restart) reuses the cache: no provider request.
    const secondCalls = [];
    const secondFetch = async (url) => { secondCalls.push(url); return jsonResponse({ teams: [], competitions: [] }); };
    const second = startSession({ fetch: secondFetch, cachePath });
    second.socket.emit("data", settingsFrame("paramfromplugin", { token: "apikey-9f3b-secret", competition: "PD" }));
    await drain();
    assert.deepEqual(selectorCalls(secondCalls), [], "a restart with a warm cache must not re-list the selectors");
    const cachedPushes = pushes(second.recorder);
    assert.deepEqual(cachedPushes[0].payload, { competitions: [{ code: "PD", name: "Primera Division" }] });
    assert.deepEqual(cachedPushes[1].payload, { teams: [{ id: 90, name: "Real Betis" }], competition: "PD" });

    // The on-demand refresh is the only path that reloads from the provider, and it
    // travels on the transient channel so it can never be saved as a setting.
    second.socket.emit("data", requestFrame("sendToPlugin", { token: "apikey-9f3b-secret", competition: "PD", refresh: true }));
    await drain();
    assert.deepEqual(selectorCalls(secondCalls), ["competitions", "teams"], "the refresh re-queries both lists");
    assert.equal(pushes(second.recorder).length, 4, "the refresh pushes both lists again");
  } finally {
    nodeFs.rmSync(root, { recursive: true, force: true });
  }
});
