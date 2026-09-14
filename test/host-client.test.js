"use strict";

// Slice 2a tests (launch args + upgrade handshake), the slice-2b repair
// unit's bounded frame codec tests (tasks 2.5/2.6) and slice 2c's HostClient
// ownership tests (tasks 2.7/2.8). No real socket is ever opened: connectors
// are injected doubles returning fake sockets, and every handshake/frame
// surface is pure byte parsing (design: test seams matrix).

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const hostClient = require("../src/plugin/host-client.js");
const {
  LaunchArgsError,
  UpgradeError,
  ProtocolError,
  HostClient,
  connectWithLaunchArgs,
  createUpgradeRequest,
  decodeServerFrames,
  encodeClientFrame,
  parseLaunchArgs,
  parseUpgradeResponse,
} = hostClient;

const VALID_ARGV = ["node", "dist/main.js", "127.0.0.1", "39069", "en"];
const UPGRADE_KEY = "dGhlIHNhbXBsZSBub25jZQ==";
const FRAME_BYTES = Buffer.from([0x81, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);

// Test-side RFC 6455 §1.3 oracle for Sec-WebSocket-Accept, derived here so it
// stays independent of the implementation under test.
function acceptValueFor(key) {
  return crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}

function upgradeResponse(
  { status = "HTTP/1.1 101 Switching Protocols", upgrade = "websocket", connection = "Upgrade", accept = acceptValueFor(UPGRADE_KEY) } = {},
) {
  const lines = [status];
  if (upgrade !== null) lines.push(`Upgrade: ${upgrade}`);
  if (connection !== null) lines.push(`Connection: ${connection}`);
  if (accept !== null) lines.push(`Sec-WebSocket-Accept: ${accept}`);
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n`, "utf8");
}

function recordingConnector() {
  const calls = [];
  return { calls, connect: (endpoint) => { calls.push(endpoint); return "connector-result"; } };
}

// --- Task 2.1: launch-argument configuration seams ---

test("parseLaunchArgs honours a valid host launch triple", () => {
  assert.deepEqual(parseLaunchArgs(VALID_ARGV), { address: "127.0.0.1", port: 39069, language: "en" });
});

test("missing launch arguments fail fast and open no socket", () => {
  const cases = {
    "missing address": ["node", "dist/main.js", "39069", "en"],
    "missing port": ["node", "dist/main.js", "127.0.0.1", "en"],
    "missing language": ["node", "dist/main.js", "127.0.0.1", "39069"],
    "no arguments at all": ["node", "dist/main.js"],
  };
  for (const [name, argv] of Object.entries(cases)) {
    const { calls, connect } = recordingConnector();
    assert.throws(() => connectWithLaunchArgs(argv, connect), LaunchArgsError, name);
    assert.deepEqual(calls, [], `${name}: the connector must not be called`);
  }
});

test("invalid ports fail fast and open no socket", () => {
  for (const port of ["abc", "0", "-1", "65536", "39069.5", ""]) {
    const { calls, connect } = recordingConnector();
    const argv = ["node", "dist/main.js", "127.0.0.1", port, "en"];
    assert.throws(() => connectWithLaunchArgs(argv, connect), LaunchArgsError, `port ${JSON.stringify(port)}`);
    assert.deepEqual(calls, [], `port ${JSON.stringify(port)}: the connector must not be called`);
  }
});

test("the injected connector receives exactly the validated endpoint", () => {
  const { calls, connect } = recordingConnector();
  assert.equal(connectWithLaunchArgs(VALID_ARGV, connect), "connector-result");
  assert.deepEqual(calls, [{ address: "127.0.0.1", port: 39069 }]);
});

// --- Task 2.3: upgrade handshake seams ---

test("createUpgradeRequest emits exact handshake bytes for the injected key", () => {
  const request = createUpgradeRequest({ address: "127.0.0.1", port: 39069, key: UPGRADE_KEY });
  assert.ok(Buffer.isBuffer(request));
  assert.equal(
    request.toString("utf8"),
    "GET / HTTP/1.1\r\n" +
      "Host: 127.0.0.1:39069\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Key: ${UPGRADE_KEY}\r\n` +
      "Sec-WebSocket-Version: 13\r\n" +
      "\r\n",
  );
});

test("parseUpgradeResponse accepts a valid 101 and preserves post-header bytes", () => {
  const withRemainder = parseUpgradeResponse(Buffer.concat([upgradeResponse(), FRAME_BYTES]), UPGRADE_KEY);
  assert.deepEqual(withRemainder.remainder, FRAME_BYTES);
  const withoutRemainder = parseUpgradeResponse(upgradeResponse(), UPGRADE_KEY);
  assert.equal(withoutRemainder.remainder.length, 0);
});

test("parseUpgradeResponse rejects wrong status, incompatible headers and wrong accept", () => {
  const invalidResponses = {
    "wrong status": upgradeResponse({ status: "HTTP/1.1 400 Bad Request" }),
    "missing upgrade header": upgradeResponse({ upgrade: null }),
    "incompatible upgrade value": upgradeResponse({ upgrade: "h2c" }),
    "connection header without upgrade": upgradeResponse({ connection: "keep-alive" }),
    "missing connection header": upgradeResponse({ connection: null }),
    "missing accept header": upgradeResponse({ accept: null }),
    "wrong accept value": upgradeResponse({ accept: "QmFkVmFsdWU9" }),
  };
  for (const [name, response] of Object.entries(invalidResponses)) {
    assert.throws(() => parseUpgradeResponse(response, UPGRADE_KEY), UpgradeError, name);
  }
});

test("parseUpgradeResponse supports split-chunk accumulation and the 16 KiB cap", () => {
  const full = Buffer.concat([upgradeResponse(), FRAME_BYTES]);
  const first = full.subarray(0, 40); // ends mid-headers, before the terminator
  assert.equal(parseUpgradeResponse(first, UPGRADE_KEY), null);
  const { remainder } = parseUpgradeResponse(Buffer.concat([first, full.subarray(40)]), UPGRADE_KEY);
  assert.deepEqual(remainder, FRAME_BYTES);

  const oversized = Buffer.alloc(17 * 1024, 0x2e);
  assert.throws(() => parseUpgradeResponse(oversized, UPGRADE_KEY), UpgradeError);
  assert.equal(parseUpgradeResponse(oversized.subarray(0, 16 * 1024), UPGRADE_KEY), null);
});

// --- Task 2.5: bounded frame codec (slice-2b repair subset) ---
//
// Opcode names are local so the runtime's export list stays exactly as
// designed. MASK is the injected fixed client mask; maskedCopy is an
// independent test-side RFC 6455 §5.3 oracle so exact-byte assertions never
// reuse the implementation's XOR loop.
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
const MASK = Buffer.from([0x01, 0x02, 0x03, 0x04]);

function maskedCopy(payload, mask) {
  const out = Buffer.from(payload);
  for (let i = 0; i < out.length; i += 1) out[i] ^= mask[i % 4];
  return out;
}

test("encodeClientFrame emits exact masked bytes for the injected mask", () => {
  assert.equal(typeof encodeClientFrame, "function");
  assert.equal(typeof decodeServerFrames, "function");
  assert.equal(typeof ProtocolError, "function");
  const frame = encodeClientFrame("Hello", { opcode: OP_TEXT, mask: MASK });
  const expected = Buffer.concat([
    Buffer.from([0x80 | OP_TEXT, 0x80 | 5, 0x01, 0x02, 0x03, 0x04]),
    maskedCopy(Buffer.from("Hello", "utf8"), MASK),
  ]);
  assert.deepEqual(frame, expected);
});

test("encodeClientFrame switches length encodings at the 125/126 and 16/64-bit boundaries", () => {
  const p125 = Buffer.alloc(125, 0x61);
  const f125 = encodeClientFrame(p125, { opcode: OP_TEXT, mask: MASK });
  assert.equal(f125[1], 0x80 | 125);
  assert.equal(f125.length, 6 + 125);

  const p126 = Buffer.alloc(126, 0x61);
  const f126 = encodeClientFrame(p126, { opcode: OP_TEXT, mask: MASK });
  assert.equal(f126[1], 0x80 | 126);
  assert.equal(f126.readUInt16BE(2), 126);
  assert.equal(f126.length, 8 + 126);

  const p64k = Buffer.alloc(65536, 0x61);
  const f64k = encodeClientFrame(p64k, { opcode: OP_TEXT, mask: MASK });
  assert.equal(f64k[1], 0x80 | 127);
  assert.deepEqual(f64k.subarray(2, 10), Buffer.from([0, 0, 0, 0, 0, 1, 0, 0]));
  assert.equal(f64k.length, 14 + 65536);
});

test("encodeClientFrame always emits masked client frames (DA4)", () => {
  const throwsTypeError = (error) => error instanceof TypeError;
  assert.throws(() => encodeClientFrame("x", { opcode: OP_TEXT }), throwsTypeError);
  assert.throws(() => encodeClientFrame("x", { opcode: OP_TEXT, mask: Buffer.alloc(3) }), throwsTypeError);
  assert.throws(() => encodeClientFrame(42, { opcode: OP_TEXT, mask: MASK }), throwsTypeError);
});

test("decodeServerFrames decodes a server text frame and retains nothing extra", () => {
  const { frames, remainder } = decodeServerFrames(FRAME_BYTES);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].fin, true);
  assert.equal(frames[0].opcode, OP_TEXT);
  assert.deepEqual(frames[0].payload, Buffer.from("hello", "utf8"));
  assert.equal(remainder.length, 0);
});

test("decodeServerFrames handles the 125/126 payload length boundary", () => {
  const p125 = Buffer.alloc(125, 0x62);
  const r125 = decodeServerFrames(Buffer.concat([Buffer.from([0x81, 125]), p125]));
  assert.equal(r125.frames.length, 1);
  assert.deepEqual(r125.frames[0].payload, p125);

  const p126 = Buffer.alloc(126, 0x62);
  const r126 = decodeServerFrames(Buffer.concat([Buffer.from([0x81, 126, 0x00, 126]), p126]));
  assert.equal(r126.frames.length, 1);
  assert.deepEqual(r126.frames[0].payload, p126);
});

test("decodeServerFrames retains partial frames across chunks", () => {
  const full = Buffer.concat([FRAME_BYTES, Buffer.from([0x81, 0x03]), Buffer.from("abc", "utf8")]);
  const half = full.subarray(0, 4); // ends mid-payload of the first frame
  const step1 = decodeServerFrames(half);
  assert.deepEqual(step1.frames, []);
  assert.deepEqual(step1.remainder, half);

  const step2 = decodeServerFrames(Buffer.concat([step1.remainder, full.subarray(4)]));
  assert.equal(step2.frames.length, 2);
  assert.deepEqual(step2.frames[1].payload, Buffer.from("abc", "utf8"));
  assert.equal(step2.remainder.length, 0);
});

test("decodeServerFrames processes coalesced text, ping and pong frames in order", () => {
  const ping = Buffer.concat([Buffer.from([0x80 | OP_PING, 0x02]), Buffer.from([0x3a, 0x29])]);
  const pong = Buffer.concat([Buffer.from([0x80 | OP_PONG, 0x01]), Buffer.from([0x21])]);
  const { frames, remainder } = decodeServerFrames(Buffer.concat([FRAME_BYTES, ping, pong]));
  assert.equal(frames.length, 3);
  assert.equal(frames[0].opcode, OP_TEXT);
  assert.equal(frames[1].opcode, OP_PING);
  assert.equal(frames[2].opcode, OP_PONG);
  assert.equal(remainder.length, 0);
});

test("a decoded server ping pairs with a masked client pong echoing its payload", () => {
  const pingPayload = Buffer.from([0x3a, 0x29]);
  const ping = Buffer.concat([Buffer.from([0x80 | OP_PING, pingPayload.length]), pingPayload]);
  const { frames } = decodeServerFrames(ping);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].opcode, OP_PING);
  assert.deepEqual(frames[0].payload, pingPayload);

  const pong = encodeClientFrame(frames[0].payload, { opcode: OP_PONG, mask: MASK });
  assert.equal(pong[0], 0x80 | OP_PONG);
  assert.equal(pong[1], 0x80 | pingPayload.length);
  assert.deepEqual(pong.subarray(2, 6), MASK);
  assert.deepEqual(pong.subarray(6), maskedCopy(pingPayload, MASK));
});

test("a close frame ends dispatch: nothing after it is decoded", () => {
  const trailing = Buffer.concat([Buffer.from([0x81, 0x01]), Buffer.from("x", "utf8")]);
  const stream = Buffer.concat([FRAME_BYTES, Buffer.from([0x80 | OP_CLOSE, 0x00]), trailing]);
  const { frames, remainder } = decodeServerFrames(stream);
  assert.equal(frames.length, 2);
  assert.equal(frames[1].opcode, OP_CLOSE);
  assert.equal(remainder.length, 0);
});

test("malformed, fragmented, binary, masked-server and oversized frames are protocol errors", () => {
  const oversizedHeader = (lengthBytes) =>
    Buffer.concat([Buffer.from([0x81, 127]), lengthBytes, Buffer.alloc(8)]);
  const cases = [
    ["reserved RSV bits", Buffer.from([0xc1, 0x00]), /reserved/],
    ["unknown opcode", Buffer.from([0x83, 0x00]), /unsupported frame opcode/],
    ["fragmented text frame", Buffer.from([0x01, 0x00]), /fragmented data/],
    ["continuation frame", Buffer.from([0x80, 0x00]), /continuation/],
    ["binary frame", Buffer.from([0x82, 0x00]), /binary/],
    ["masked server frame", Buffer.from([0x81, 0x80]), /must not be masked/],
    ["fragmented control frame", Buffer.from([0x09, 0x00]), /fragmented control/],
    ["oversized control frame", Buffer.from([0x89, 126, 0x00, 126]), /125 bytes/],
    ["payload above the 1 MiB cap", oversizedHeader(Buffer.from([0, 0, 0, 0, 0, 0x10, 0x00, 0x01])), /1 MiB/],
    ["absurd 64-bit length", oversizedHeader(Buffer.from([0x80, 0, 0, 0, 0, 0, 0, 0])), /1 MiB/],
  ];
  for (const [name, frame, pattern] of cases) {
    const throwsProtocolError = (error) => error instanceof ProtocolError && pattern.test(error.message);
    assert.throws(() => decodeServerFrames(frame), throwsProtocolError, name);
  }
});

test("a malformed frame in a coalesced stream prevents partial dispatch", () => {
  const badTail = Buffer.from([0x80 | 0x2, 0x00]); // unsupported binary frame
  assert.throws(
    () => decodeServerFrames(Buffer.concat([FRAME_BYTES, badTail])),
    (error) => error instanceof ProtocolError,
  );
});

// --- Tasks 2.7/2.8: HostClient socket ownership over a fake socket ---
// The fake socket is a local EventEmitter double: `write` records raw bytes
// and `destroy` mimics net.Socket by ending in a 'close' emission.

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.sportboard";
const ACTION_UUID = "com.ulanzi.ulanzistudio.sportboard.status";

// Test-side oracle: unmasks an outbound client frame with its own embedded
// mask so exact-payload assertions never reuse the implementation's XOR loop.
function decodeMaskedClientFrame(buffer) {
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  const size = buffer[1] & 0x7f;
  let offset = 2;
  let length = size;
  if (size === 126) { length = buffer.readUInt16BE(2); offset = 4; }
  if (size === 127) { length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
  const mask = buffer.subarray(offset, offset + 4);
  const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
  for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  return { opcode, masked, payload };
}

function serverTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

function serverControlFrame(opcode, payloadBytes) {
  return Buffer.concat([Buffer.from([0x80 | opcode, payloadBytes.length]), Buffer.from(payloadBytes)]);
}

function createFakeSocket(recorder) {
  const socket = new EventEmitter();
  socket.writable = true;
  socket.destroyed = false;
  socket.write = (data) => {
    recorder.rawWrites.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    recorder.timeline.push("write");
    return true;
  };
  socket.destroy = () => {
    socket.destroyed = true;
    socket.writable = false;
    socket.emit("close"); // real net.Socket behaviour: destroy ends in 'close'
  };
  return socket;
}

function createHarness() {
  const recorder = { rawWrites: [], timeline: [], connects: [], events: [] };
  const socket = createFakeSocket(recorder);
  const client = new HostClient({
    pluginUuid: PLUGIN_UUID,
    connect: (endpoint) => { recorder.connects.push(endpoint); return socket; },
    randomBytes: (size) => Buffer.alloc(size, 0xcd),
  });
  for (const name of ["connected", "add", "run", "clear", "error", "close", "paramfromplugin", "didReceiveSettings", "sendToPlugin"]) {
    client.on(name, (payload) => {
      recorder.timeline.push(`event:${name}`);
      recorder.events.push({ name, payload });
    });
  }
  return { client, socket, recorder };
}

function startSession(harness) {
  harness.client.connect({ address: "127.0.0.1", port: 39069 });
  harness.socket.emit("connect");
}

function completeUpgrade(harness) {
  const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(harness.recorder.rawWrites[0].toString("utf8"))[1];
  const response = `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptValueFor(key)}\r\n\r\n`;
  harness.socket.emit("data", Buffer.from(response, "utf8"));
}

function writtenFrames(recorder) {
  return recorder.rawWrites.slice(1).map((buffer) => {
    const frame = decodeMaskedClientFrame(buffer);
    return { ...frame, text: frame.payload.toString("utf8") };
  });
}

test("HostClient is an EventEmitter transport that opens exactly one socket", () => {
  const harness = createHarness();
  assert.ok(harness.client instanceof EventEmitter);
  assert.throws(() => harness.client.connect({ address: "127.0.0.1" }), TypeError);
  harness.client.connect({ address: "127.0.0.1", port: 39069 });
  assert.deepEqual(harness.recorder.connects, [{ address: "127.0.0.1", port: 39069 }]);
  assert.throws(() => harness.client.connect({ address: "10.0.0.1", port: 1234 }), /already owns a socket/);
  assert.deepEqual(harness.recorder.connects, [{ address: "127.0.0.1", port: 39069 }]);
});

test("a valid upgrade is answered with the exact connected payload", () => {
  const harness = createHarness();
  startSession(harness);
  completeUpgrade(harness);
  assert.deepEqual(harness.recorder.timeline, ["write", "write", "event:connected"]);
  const [connected] = writtenFrames(harness.recorder);
  assert.equal(connected.opcode, OP_TEXT);
  assert.equal(connected.text, '{"cmd":"connected","uuid":"com.ulanzi.ulanzistudio.sportboard","code":0}');
});

test("valid requests are acknowledged on the same socket before their events dispatch", () => {
  const harness = createHarness();
  startSession(harness);
  completeUpgrade(harness);
  const context = `${PLUGIN_UUID}___K1___${ACTION_UUID}`;
  const request = (cmd) => ({ cmd, uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID });
  const add = request("add");
  const run = request("run");
  const clear = { ...request("clear"), param: [request("ignored")] };
  for (const message of [add, run, clear]) {
    harness.socket.emit("data", serverTextFrame(JSON.stringify(message)));
  }
  assert.deepEqual(harness.recorder.timeline, [
    "write", "write", "event:connected",
    "write", "event:add",
    "write", "event:run",
    "write", "event:clear",
  ]);
  const frames = writtenFrames(harness.recorder);
  assert.deepEqual(JSON.parse(frames[1].text), { ...add, code: 0 });
  assert.deepEqual(JSON.parse(frames[2].text), { ...run, code: 0 });
  assert.deepEqual(JSON.parse(frames[3].text), { ...clear, code: 0 });
  const dispatched = Object.fromEntries(
    harness.recorder.events.filter((event) => event.name !== "connected").map((event) => [event.name, event.payload]),
  );
  assert.equal(dispatched.add.context, context);
  assert.equal(dispatched.run.context, context);
  assert.equal(dispatched.clear.param[0].context, context);
  assert.equal(harness.recorder.connects.length, 1); // every response stayed on the one owned socket
});

test("malformed JSON and non-request messages cause no dispatch and no response loop", () => {
  const harness = createHarness();
  startSession(harness);
  completeUpgrade(harness);
  const before = harness.recorder.rawWrites.length;
  for (const payload of ["not json", "[1,2]", "null", '{"cmd":""}', '{"cmd":"add","code":0}']) {
    harness.socket.emit("data", serverTextFrame(payload));
  }
  assert.equal(harness.recorder.rawWrites.length, before);
  assert.deepEqual(harness.recorder.events.filter((event) => event.name !== "connected"), []);
  const request = { cmd: "run", uuid: PLUGIN_UUID, key: "K2", actionid: ACTION_UUID };
  harness.socket.emit("data", serverTextFrame(JSON.stringify(request)));
  const frames = writtenFrames(harness.recorder);
  assert.deepEqual(JSON.parse(frames[frames.length - 1].text), { ...request, code: 0 });
  assert.ok(harness.recorder.events.some((event) => event.name === "run"));
});

test("a socket error is emitted once, destroys the socket and never reconnects", () => {
  const harness = createHarness();
  startSession(harness);
  completeUpgrade(harness);
  const failure = new Error("ECONNRESET");
  harness.socket.emit("error", failure);
  harness.socket.emit("error", failure);
  const errors = harness.recorder.events.filter((event) => event.name === "error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].payload, failure);
  assert.equal(harness.socket.destroyed, true);
  const before = harness.recorder.rawWrites.length;
  harness.socket.emit("data", serverTextFrame('{"cmd":"add"}'));
  assert.equal(harness.recorder.rawWrites.length, before);
  assert.throws(() => harness.client.connect({ address: "127.0.0.1", port: 1 }), /already owns a socket/);
  assert.equal(harness.recorder.connects.length, 1);
});

test("a socket close is emitted once with no reconnect or endpoint fallback", () => {
  const harness = createHarness();
  startSession(harness);
  completeUpgrade(harness);
  harness.socket.emit("close");
  harness.socket.emit("close");
  assert.equal(harness.recorder.events.filter((event) => event.name === "close").length, 1);
  assert.throws(() => harness.client.connect({ address: "127.0.0.1", port: 1 }), /already owns a socket/);
  assert.equal(harness.recorder.connects.length, 1);
  const before = harness.recorder.rawWrites.length;
  harness.socket.emit("data", serverTextFrame("late"));
  assert.equal(harness.recorder.rawWrites.length, before);
});

test("a close frame ends dispatch, destroys the socket and emits close once", () => {
  const harness = createHarness();
  startSession(harness);
  completeUpgrade(harness);
  const stream = Buffer.concat([
    serverControlFrame(OP_CLOSE, []),
    serverTextFrame(JSON.stringify({ cmd: "add", uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID })),
  ]);
  harness.socket.emit("data", stream);
  harness.socket.emit("data", serverTextFrame('{"cmd":"run"}')); // dispatch stays ended after close
  assert.equal(harness.recorder.events.filter((event) => event.name === "close").length, 1);
  assert.equal(harness.socket.destroyed, true);
  assert.deepEqual(harness.recorder.events.filter((event) => event.name === "add" || event.name === "run"), []);
});

test("an invalid upgrade destroys the socket before any connected payload", () => {
  const harness = createHarness();
  startSession(harness);
  harness.socket.emit("data", Buffer.from(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: wrong==\r\n\r\n",
    "utf8",
  ));
  assert.equal(harness.recorder.rawWrites.length, 1); // only the upgrade request was ever written
  assert.equal(harness.socket.destroyed, true);
  const errors = harness.recorder.events.filter((event) => event.name === "error");
  assert.equal(errors.length, 1);
  assert.ok(errors[0].payload instanceof UpgradeError);
});

test("a server ping is answered by one bounded masked pong on the same socket", () => {
  const harness = createHarness();
  startSession(harness);
  completeUpgrade(harness);
  harness.socket.emit("data", serverControlFrame(OP_PING, [0x3a, 0x29]));
  const frames = writtenFrames(harness.recorder);
  assert.equal(frames.length, 2);
  assert.equal(frames[1].opcode, OP_PONG);
  assert.equal(frames[1].masked, true);
  assert.deepEqual([...frames[1].payload], [0x3a, 0x29]);
  const before = harness.recorder.rawWrites.length;
  harness.socket.emit("data", serverControlFrame(OP_PONG, [0x21]));
  assert.equal(harness.recorder.rawWrites.length, before); // a server pong is never answered
});

test("sendObject is false before upgrade completion and on a non-writable socket", () => {
  const harness = createHarness();
  assert.equal(harness.client.sendObject({ hello: 1 }), false);
  assert.equal(harness.recorder.rawWrites.length, 0); // nothing queued while disconnected
  startSession(harness);
  assert.equal(harness.client.sendObject({ hello: 1 }), false);
  assert.equal(harness.recorder.rawWrites.length, 1); // only the upgrade request exists
  completeUpgrade(harness);
  assert.equal(harness.client.sendObject({ hello: 1 }), true);
  const frames = writtenFrames(harness.recorder);
  assert.deepEqual(JSON.parse(frames[frames.length - 1].text), { hello: 1 });
  harness.socket.writable = false;
  assert.equal(harness.client.sendObject({ hello: 1 }), false);
});

test("HostClient exposes exactly one dynamic rendering method and no title or path surface", () => {
  const rendering = Object.getOwnPropertyNames(HostClient.prototype).filter((name) =>
    /image|title|base64|path|icon/i.test(name),
  );
  assert.deepEqual(rendering, ["setBaseDataIcon"]);
  assert.equal(typeof HostClient.prototype.setBaseDataIcon, "function");
});

test("createImageCommand emits the exact type-1 payload and rejects non-SVG data", () => {
  const { createImageCommand } = hostClient;
  const PLUGIN_UUID = "com.ulanzi.ulanzistudio.sportboard";
  const ACTION_UUID = `${PLUGIN_UUID}.status`;
  const CONTEXT = `${PLUGIN_UUID}___K1___${ACTION_UUID}`;
  const data = "data:image/svg+xml;base64,PHN2Zy8+";
  assert.deepEqual(createImageCommand(PLUGIN_UUID, CONTEXT, data), {
    cmd: "state",
    uuid: PLUGIN_UUID,
    param: {
      statelist: [{ uuid: PLUGIN_UUID, key: "K1", actionid: ACTION_UUID, type: 1, data, textData: "", showtext: false }],
    },
  });
  for (const invalid of ["", "https://example.com/a.svg", "data:image/png;base64,AAAA", undefined]) {
    assert.throws(() => createImageCommand(PLUGIN_UUID, CONTEXT, invalid), /SVG data URI/, String(invalid));
  }
  assert.throws(() => createImageCommand("", CONTEXT, data), /plugin UUID/);
});

test("sendToPropertyInspector emits the exact protocol command for one context", () => {
  const harness = createHarness();
  startSession(harness);
  completeUpgrade(harness);
  const context = `${PLUGIN_UUID}___K1___${PLUGIN_UUID}.status`;
  harness.client.sendToPropertyInspector(context, { teams: [{ id: 90, name: "Real Betis" }] });
  const frames = writtenFrames(harness.recorder);
  // The reply echoes the context it belongs to, byte for byte, so the host can
  // route it back to that key. It must never substitute the plugin uuid.
  assert.deepEqual(JSON.parse(frames.at(-1).text), {
    cmd: "sendToPropertyInspector",
    uuid: PLUGIN_UUID,
    key: "K1",
    actionid: `${PLUGIN_UUID}.status`,
    payload: { teams: [{ id: 90, name: "Real Betis" }] },
  });
  // A context whose uuid is the action uuid is echoed verbatim as well.
  harness.client.sendToPropertyInspector(`${PLUGIN_UUID}.status___K2___${PLUGIN_UUID}.status`, { teams: [] });
  const echoed = JSON.parse(writtenFrames(harness.recorder).at(-1).text);
  assert.equal(echoed.uuid, `${PLUGIN_UUID}.status`);
  assert.equal(echoed.key, "K2");
  assert.notEqual(echoed.uuid, PLUGIN_UUID);
});

test("an inspector request reaches the main service as a sendToPlugin event", () => {
  const harness = createHarness();
  startSession(harness);
  completeUpgrade(harness);
  harness.socket.emit("data", serverTextFrame(JSON.stringify({
    cmd: "sendToPlugin",
    uuid: PLUGIN_UUID,
    key: "K1",
    actionid: `${PLUGIN_UUID}.status`,
    payload: { request: "teams" },
  })));
  const dispatched = harness.recorder.events.filter((event) => event.name === "sendToPlugin");
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].payload.context, `${PLUGIN_UUID}___K1___${PLUGIN_UUID}.status`);
  assert.deepEqual(dispatched[0].payload.payload, { request: "teams" });
});

test("durable saved settings reach the main service", () => {
  const harness = createHarness();
  startSession(harness);
  completeUpgrade(harness);
  harness.socket.emit("data", serverTextFrame(JSON.stringify({
    cmd: "didReceiveSettings",
    uuid: PLUGIN_UUID,
    key: "K1",
    actionid: `${PLUGIN_UUID}.status`,
    settings: { token: "secret", competition: "PD", teamId: "90" },
  })));
  const dispatched = harness.recorder.events.filter((event) => event.name === "didReceiveSettings");
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].payload.context, `${PLUGIN_UUID}___K1___${PLUGIN_UUID}.status`);
  assert.equal(dispatched[0].payload.settings.teamId, "90");
});

test("host-client.js is the sole runtime importer of networking built-ins", () => {
  const pluginDir = path.join(__dirname, "..", "src", "plugin");
  const forbidden = /require\(\s*["'](?:node:)?(?:net|http|https|tls|dgram|dns)["']\s*\)|\bfetch\(|\.listen\(|createServer\(/;
  for (const entry of fs.readdirSync(pluginDir).sort()) {
    if (!entry.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(pluginDir, entry), "utf8");
    if (entry === "host-client.js") {
      assert.match(source, /require\(\s*["']node:net["']\s*\)/); // the sole node:net importer
      assert.doesNotMatch(source, /\bfetch\(|\.listen\(|createServer\(/);
    } else {
      assert.doesNotMatch(source, forbidden, `${entry} must not import a networking built-in`);
    }
  }
  assert.doesNotMatch(fs.readFileSync(__filename, "utf8"), /require\(\s*["'](?:node:)?net["']\s*\)/); // no real socket in tests
});
