"use strict";

// Slice 3 tests (tasks 3.1–3.8): the host protocol helpers (createAck,
// createStateCommand, encodeContext/decodeContext), the ActionRuntime state
// machine, and the main.js start() composition. No real socket is opened:
// connectors inject fake sockets, and the process smoke spawns a child that
// fails on launch arguments before any network call (A1).

const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const EventEmitter = require("node:events");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { HostClient, createAck, createStateCommand, decodeContext, encodeContext } = require("../src/plugin/host-client.js");

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.sportboard";
const ACTION_UUID = "com.ulanzi.ulanzistudio.sportboard.status";
const VALID_ARGV = ["node", "dist/main.js", "127.0.0.1", "39069", "en"];
const CONTEXT = `${PLUGIN_UUID}___K1___${ACTION_UUID}`;
const event = (key) => ({ actionid: ACTION_UUID, context: `${PLUGIN_UUID}___${key}___${ACTION_UUID}` });

// Fake socket double: `write` records raw byte buffers, `destroy` mimics
// net.Socket by ending in a 'close' emission.
function createFakeSocket(recorder) {
  const socket = new EventEmitter();
  socket.writable = true;
  socket.destroyed = false;
  socket.write = (data) => { recorder.rawWrites.push(data); return true; };
  socket.destroy = () => { socket.destroyed = true; socket.writable = false; socket.emit("close"); };
  return socket;
}

// Test-side RFC 6455 oracle: unmasks outbound client frames (skipping the
// upgrade request at rawWrites[0]) into the JSON objects they carry.
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

// Completes the upgrade against the fake socket using the key the client
// actually sent and an independent test-side RFC 6455 §1.3 accept oracle.
function completeUpgrade(recorder, socket) {
  const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(recorder.rawWrites[0].toString("utf8"))[1];
  const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.emit("data", Buffer.from(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    "utf8",
  ));
}

// The exact type-0 state command for a key, used in ordered-sequence asserts.
function stateCommand(stateIndex) {
  return {
    cmd: "state",
    uuid: PLUGIN_UUID,
    param: { statelist: [{ uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID, type: 0, state: stateIndex, textData: "", showtext: false }] },
  };
}

// ActionRuntime harness: the host is a recording double with setState.
function buildRuntime({ actionUuid = ACTION_UUID, stateCount = 2 } = {}) {
  const sent = [];
  const host = { setState: (context, stateIndex) => sent.push({ context, stateIndex }) };
  const { ActionRuntime } = require("../src/plugin/action-runtime.js");
  return { runtime: new ActionRuntime({ host, actionUuid, stateCount }), sent };
}

// --- Tasks 3.1/3.2: protocol helpers on the host boundary ---

test("createStateCommand emits the exact type-0 payload and rejects bad indexes", () => {
  assert.deepEqual(createStateCommand(PLUGIN_UUID, CONTEXT, 1), {
    cmd: "state",
    uuid: PLUGIN_UUID,
    param: {
      statelist: [{ uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID, type: 0, state: 1, textData: "", showtext: false }],
    },
  });
  for (const stateIndex of [-1, 1.5, Number.NaN, "1", undefined]) {
    assert.throws(() => createStateCommand(PLUGIN_UUID, CONTEXT, stateIndex), /state index/, String(stateIndex));
  }
  assert.throws(() => createStateCommand(PLUGIN_UUID, "not-a-context", 0), /three non-empty/);
});

test("createAck returns the request envelope with code 0 under the same cmd", () => {
  const request = { cmd: "run", uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID, extra: "kept" };
  assert.deepEqual(createAck(request, PLUGIN_UUID), { ...request, code: 0 });
  assert.equal(createAck(request, PLUGIN_UUID).cmd, "run");
  assert.throws(() => createAck(request, ""), TypeError);
  assert.throws(() => createAck({ cmd: "" }, PLUGIN_UUID), TypeError);
});

test("encodeContext and decodeContext round-trip; malformed contexts are rejected", () => {
  const context = encodeContext({ uuid: PLUGIN_UUID, key: "K7", actionid: ACTION_UUID });
  assert.equal(context, `${PLUGIN_UUID}___K7___${ACTION_UUID}`);
  assert.deepEqual(decodeContext(context), { uuid: PLUGIN_UUID, key: "K7", actionid: ACTION_UUID });
  for (const malformed of ["too-few___parts", `${PLUGIN_UUID}___K1___${ACTION_UUID}___extra`, "a______c", ""]) {
    assert.throws(() => decodeContext(malformed), /three non-empty/, JSON.stringify(malformed));
  }
});

// --- Task 3.3: ActionRuntime lifecycle (DA2) ---

test("add selects state 0, run cycles 1 -> 0, duplicate add resets, run before add is tolerated", () => {
  const { runtime, sent } = buildRuntime();
  const ev = event("K1");
  runtime.add(ev);
  runtime.run(ev);
  runtime.run(ev);
  runtime.add(ev);
  assert.deepEqual(sent, [
    { context: ev.context, stateIndex: 0 },
    { context: ev.context, stateIndex: 1 },
    { context: ev.context, stateIndex: 0 },
    { context: ev.context, stateIndex: 0 },
  ]);
  const fresh = event("K2"); // run before add: state 0 is created first, then advanced
  runtime.run(fresh);
  assert.deepEqual(sent.at(-1), { context: fresh.context, stateIndex: 1 });
});

test("clear deletes each param[] context", () => {
  const { runtime, sent } = buildRuntime();
  runtime.add(event("K1"));
  runtime.add(event("K2"));
  runtime.clear({ param: [{ context: event("K1").context }, { context: event("K2").context }] });
  runtime.run(event("K1"));
  runtime.run(event("K2"));
  assert.deepEqual(sent.map((send) => send.stateIndex), [0, 0, 1, 1]); // both gone: run-before-add path
  runtime.clear(undefined); // a clear without param[] deletes nothing and never throws
});

test("undeclared actions cause no mutation and no state command", () => {
  const { runtime, sent } = buildRuntime();
  runtime.add({ actionid: "com.other.action", context: CONTEXT });
  runtime.run({ actionid: "com.other.action", context: CONTEXT });
  runtime.setState({ actionid: "com.other.action", context: CONTEXT }, 0);
  assert.deepEqual(sent, []);
  runtime.run(event("K1")); // the declared action still works normally afterwards
  assert.deepEqual(sent, [{ context: event("K1").context, stateIndex: 1 }]);
});

test("dispose clears the map and stateCount bounds are enforced (DA2)", () => {
  const { runtime, sent } = buildRuntime();
  runtime.add(event("K1"));
  runtime.dispose();
  runtime.run(event("K1")); // map was cleared: the run takes the run-before-add path
  assert.deepEqual(sent.map((send) => send.stateIndex), [0, 1]);

  const wide = buildRuntime({ stateCount: 3 });
  const ev = event("K3");
  wide.runtime.add(ev);
  wide.runtime.run(ev);
  wide.runtime.run(ev);
  assert.deepEqual(wide.sent.map((send) => send.stateIndex), [0, 1, 2]);
  assert.throws(() => wide.runtime.setState(ev, 3), /declared range/); // index 2 is the ceiling
  assert.throws(() => runtime.setState(event("K1"), -1), /declared range/);
  assert.equal(wide.sent.at(-1).stateIndex, 2); // the rejected sends never reached the host
});

// --- Tasks 3.5–3.7: start() composition and process smoke ---

test("start exits non-zero with one sanitized argument error and never connects", () => {
  const main = require("../src/plugin/main.js");
  for (const argv of [["node", "dist/main.js"], ["node", "dist/main.js", "127.0.0.1", "0", "en"]]) {
    const recorder = { rawWrites: [], connects: [] };
    const lines = [];
    const status = main.start({
      argv,
      connect: (endpoint) => { recorder.connects.push(endpoint); return createFakeSocket(recorder); },
      stderr: (line) => lines.push(line),
    });
    assert.equal(status, 1, JSON.stringify(argv));
    assert.deepEqual(recorder.connects, [], "no connector call may happen for invalid launch arguments");
    assert.equal(lines.length, 1, JSON.stringify(argv));
    assert.match(lines[0], /invalid launch arguments/);
    assert.doesNotMatch(lines[0], /127\.0\.0\.1|39069|cmd|uuid|HTTP/);
  }
});

test("start registers the lifecycle handlers before the single connect", () => {
  const main = require("../src/plugin/main.js");
  const order = [];
  const originalOn = HostClient.prototype.on;
  HostClient.prototype.on = function (name, listener) {
    order.push(`on:${name}`);
    return originalOn.call(this, name, listener);
  };
  try {
    main.start({
      argv: VALID_ARGV,
      connect: (endpoint) => {
        order.push("connect");
        return createFakeSocket({ rawWrites: [], connects: [] });
      },
      stderr: () => {},
    });
  } finally {
    HostClient.prototype.on = originalOn;
  }
  const connectIndex = order.indexOf("connect");
  assert.equal(order.filter((entry) => entry === "connect").length, 1); // exactly one connect
  for (const name of ["add", "run", "clear"]) {
    assert.ok(connectIndex > order.indexOf(`on:${name}`), `${name} must be registered before connect`);
  }
});

test("start runs the exact ordered stubbed sequence (connected -> add -> run -> run -> clear)", () => {
  const main = require("../src/plugin/main.js");
  const recorder = { rawWrites: [], connects: [] };
  const socket = createFakeSocket(recorder);
  const addReq = { cmd: "add", uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID };
  const runReq = { cmd: "run", uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID };
  const clearReq = { cmd: "clear", uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID, param: [{ uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID }] };
  const lines = [];
  const status = main.start({
    argv: VALID_ARGV,
    connect: (endpoint) => { recorder.connects.push(endpoint); return socket; },
    randomBytes: (size) => Buffer.alloc(size, 0xcd),
    stderr: (line) => lines.push(line),
  });
  assert.equal(status, 0);
  socket.emit("connect");
  completeUpgrade(recorder, socket);
  socket.emit("data", serverTextFrame(JSON.stringify(addReq)));
  socket.emit("data", serverTextFrame(JSON.stringify(runReq)));
  socket.emit("data", serverTextFrame(JSON.stringify(runReq)));
  socket.emit("data", serverTextFrame(JSON.stringify(clearReq)));
  // A key press is owned only by the dynamic team view. The ordered sequence pins
  // that no transient type-0 ActionRuntime state flashes before the dynamic image.
  const payloads = outboundPayloads(recorder);
  assert.deepEqual(payloads.map((payload) => payload.cmd), [
    "connected", "add", "state", "sendToPropertyInspector", "state",
    "run", "state", "run", "state", "clear",
  ]);
  assert.deepEqual(payloads[0], { cmd: "connected", uuid: PLUGIN_UUID, code: 0 });
  assert.deepEqual(payloads[1], { ...addReq, code: 0 });
  assert.deepEqual(payloads[2], stateCommand(0));
  // `add` carries the saved settings, so it also re-syncs the selector lists; with no
  // token saved the service asks for one instead of calling the provider.
  assert.deepEqual(payloads[3], {
    cmd: "sendToPropertyInspector",
    uuid: PLUGIN_UUID,
    key: "K1",
    actionid: ACTION_UUID,
    payload: { teams: [], error: "token required" },
  });
  assert.deepEqual(payloads[5], { ...runReq, code: 0 });
  assert.deepEqual(payloads[7], { ...runReq, code: 0 });
  assert.deepEqual(payloads[9], { ...clearReq, code: 0 });
  for (const index of [4, 6, 8]) {
    const image = payloads[index].param.statelist[0];
    assert.equal(image.type, 1);
    assert.equal(image.uuid, PLUGIN_UUID);
    assert.equal(image.actionid, ACTION_UUID);
    const svg = Buffer.from(image.data.split(",")[1], "base64").toString("utf8");
    assert.match(svg, /Add token/);
  }
  assert.deepEqual(lines, []); // the happy path writes no stderr noise
});

test("start composes run directly to TeamRuntime.toggle without a duplicate refresh", () => {
  const main = require("../src/plugin/main.js");
  const { TeamRuntime } = require("../src/plugin/team-runtime.js");
  const calls = [];
  const originalRefresh = TeamRuntime.prototype.refresh;
  const originalToggle = TeamRuntime.prototype.toggle;
  TeamRuntime.prototype.refresh = function (event, options) { calls.push({ method: "refresh", event, options }); };
  TeamRuntime.prototype.toggle = function (event) { calls.push({ method: "toggle", event }); };
  try {
    const recorder = { rawWrites: [], connects: [] };
    const socket = createFakeSocket(recorder);
    main.start({
      argv: VALID_ARGV,
      connect: () => socket,
      randomBytes: (size) => Buffer.alloc(size, 0xcd),
      stderr: () => {},
    });
    socket.emit("connect");
    completeUpgrade(recorder, socket);
    socket.emit("data", serverTextFrame(JSON.stringify({ cmd: "run", uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID })));
    assert.deepEqual(calls.map(({ method }) => method), ["toggle"]);
    assert.equal(calls[0].event.param, undefined, "composition forwards paramless run safely");
    const runOutputs = outboundPayloads(recorder).filter((payload) => payload.cmd === "state");
    assert.deepEqual(runOutputs, [], "run emits no static state flash through ActionRuntime");
  } finally {
    TeamRuntime.prototype.refresh = originalRefresh;
    TeamRuntime.prototype.toggle = originalToggle;
  }
});

test("SIGINT and SIGTERM disposal destroys the socket once with sanitized categories only", () => {
  const main = require("../src/plugin/main.js");
  const recorder = { rawWrites: [], connects: [] };
  const socket = createFakeSocket(recorder);
  const lines = [];
  main.start({
    argv: VALID_ARGV,
    connect: (endpoint) => { recorder.connects.push(endpoint); return socket; },
    randomBytes: (size) => Buffer.alloc(size, 0xcd),
    stderr: (line) => lines.push(line),
  });
  process.emit("SIGINT");
  assert.equal(socket.destroyed, true);
  assert.deepEqual(recorder.connects.length, 1);
  assert.ok(lines.every((line) => /^runtime (error|lifecycle)/.test(line)), JSON.stringify(lines));
  assert.doesNotMatch(lines.join("\n"), /cmd|uuid|websocket|HTTP|127\.0\.0\.1/);
  const second = { rawWrites: [], connects: [] };
  const socket2 = createFakeSocket(second);
  main.start({ argv: VALID_ARGV, connect: () => socket2, stderr: () => {} });
  process.emit("SIGTERM");
  assert.equal(socket2.destroyed, true);
});

test("a host connection failure surfaces as a sanitized category, never raw payload text", () => {
  const main = require("../src/plugin/main.js");
  const recorder = { rawWrites: [], connects: [] };
  const socket = createFakeSocket(recorder);
  const lines = [];
  main.start({
    argv: VALID_ARGV,
    connect: (endpoint) => { recorder.connects.push(endpoint); return socket; },
    randomBytes: (size) => Buffer.alloc(size, 0xcd),
    stderr: (line) => lines.push(line),
  });
  socket.emit("connect");
  socket.emit("data", Buffer.from("HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: deliberately-wrong==\r\n\r\n", "utf8"));
  assert.equal(lines.length, 2); // one error category + one close category
  assert.match(lines[0], /^runtime error/);
  assert.match(lines[1], /^runtime lifecycle/);
  assert.doesNotMatch(lines.join("\n"), /HTTP|websocket|Accept|cmd|uuid|127\.0\.0\.1/);
});

test("process smoke: node src/plugin/main.js without arguments fails sanitized and socketless", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "src", "plugin", "main.js")], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const lines = result.stderr.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /invalid launch arguments/);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(lines[0], /127\.0\.0\.1|39069|websocket|cmd|uuid/);
});
