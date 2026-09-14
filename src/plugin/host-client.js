"use strict";

// src/plugin/host-client.js — the plugin's sole network boundary.
//
// Slice 2a owns launch-argument validation (A1) and the WebSocket HTTP
// upgrade handshake (DA4); the slice-2b repair unit added the bounded frame
// codec (tasks 2.5/2.6). Slice 2c (tasks 2.7/2.8) completes the module with
// HostClient, the single-socket transport owner: one connector call, the
// exact connected payload, same-socket acknowledgement before local dispatch,
// bounded same-socket pong replies, and a terminal error/close boundary with
// no reconnect or endpoint fallback. Slice 3 (tasks 3.1/3.2) adds the
// application protocol helpers — createAck, createStateCommand and the
// encodeContext/decodeContext pair — plus the static-state send seam and
// process disposal.

const EventEmitter = require("node:events");
const crypto = require("node:crypto");
const net = require("node:net");

// RFC 6455 §1.3 fixed GUID used to derive Sec-WebSocket-Accept.
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Design boundary: the HTTP upgrade accumulator is capped at 16 KiB.
const MAX_UPGRADE_HEADER_BYTES = 16 * 1024;

class LaunchArgsError extends Error {
  constructor(message) {
    super(message);
    this.name = "LaunchArgsError";
  }
}

class UpgradeError extends Error {
  constructor(message) {
    super(message);
    this.name = "UpgradeError";
  }
}

// A1: the host-supplied argv[2..4] values are the only configuration source.
// Missing or invalid values fail fast; no default endpoint is ever applied.
function parseLaunchArgs(argv) {
  const address = argv[2];
  const language = argv[4];
  if (typeof address !== "string" || address.length === 0) {
    throw new LaunchArgsError("invalid launch arguments: missing address");
  }
  const port = Number(argv[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new LaunchArgsError("invalid launch arguments: port must be an integer in 1..65535");
  }
  if (typeof language !== "string" || language.length === 0) {
    throw new LaunchArgsError("invalid launch arguments: missing language");
  }
  return { address, port, language };
}

// Validation gate in front of socket ownership: the injected connector (the
// only caller allowed to open a socket) runs exactly once and only for fully
// validated arguments; every failure path returns before any connect call.
function connectWithLaunchArgs(argv, connect) {
  const { address, port } = parseLaunchArgs(argv);
  return connect({ address, port });
}

// RFC 6455 §1.3 handshake request. The key is injected so tests can pin the
// exact bytes and derive the expected Sec-WebSocket-Accept.
function createUpgradeRequest({ address, port, key }) {
  return Buffer.from(
    "GET / HTTP/1.1\r\n" +
      `Host: ${address}:${port}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Key: ${key}\r\n` +
      "Sec-WebSocket-Version: 13\r\n" +
      "\r\n",
    "utf8",
  );
}

function computeAcceptValue(key) {
  return crypto.createHash("sha1").update(`${key}${WEBSOCKET_GUID}`, "utf8").digest("base64");
}

function parseHeaders(headerText) {
  const headers = new Map();
  for (const line of headerText.split("\r\n").slice(1)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers.set(name, headers.has(name) ? `${headers.get(name)}, ${value}` : value);
  }
  return headers;
}

// Validates an HTTP 101 upgrade response and returns the bytes after the
// header terminator as the frame remainder. Returns null while the headers
// are still incomplete so the caller keeps accumulating. Throws UpgradeError
// for any invalid upgrade (and for headers beyond the 16 KiB cap) so the
// socket owner destroys the socket before any connected payload is sent.
function parseUpgradeResponse(buffer, key) {
  const searchLimit = Math.min(buffer.length, MAX_UPGRADE_HEADER_BYTES + 4);
  const terminator = buffer.subarray(0, searchLimit).indexOf("\r\n\r\n");
  if (terminator < 0) {
    if (buffer.length > MAX_UPGRADE_HEADER_BYTES) {
      throw new UpgradeError("upgrade failed: response exceeded the 16 KiB header cap");
    }
    return null; // headers incomplete: keep accumulating
  }
  const headerText = buffer.subarray(0, terminator).toString("utf8");
  const statusLine = headerText.split("\r\n")[0];
  if (!/^HTTP\/1\.1 101(\s|$)/.test(statusLine)) {
    throw new UpgradeError("upgrade failed: unexpected response status");
  }
  const headers = parseHeaders(headerText);
  const upgrade = headers.get("upgrade");
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    throw new UpgradeError("upgrade failed: incompatible Upgrade header");
  }
  const connection = headers.get("connection");
  const tokens = connection ? connection.split(",").map((item) => item.trim().toLowerCase()) : [];
  if (!tokens.includes("upgrade")) {
    throw new UpgradeError("upgrade failed: incompatible Connection header");
  }
  const accept = headers.get("sec-websocket-accept");
  if (!accept || accept !== computeAcceptValue(key)) {
    throw new UpgradeError("upgrade failed: Sec-WebSocket-Accept mismatch");
  }
  return { remainder: Buffer.from(buffer.subarray(terminator + 4)) };
}

class ProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProtocolError";
  }
}

// HostClient is the runtime's only importer of node:net (design check item 5):
// the default connector adapts the validated {address, port} endpoint into
// exactly one outbound TCP connection. No listener, server, DNS helper, HTTP
// client or second connector ever runs here.
function defaultConnect({ address, port }) {
  return net.connect({ host: address, port });
}

// HostClient owns the one client socket (design boundary rules): at most one
// connector call, the exact connected payload after a valid upgrade, same-
// socket acknowledgement before local dispatch, bounded same-socket pong
// replies through the existing codec, and a terminal error/close boundary
// with no reconnect and no endpoint fallback. Its public surface is
// connect(), sendObject(), setState() and dispose() — there is no image,
// title, path or base64 rendering method.
class HostClient extends EventEmitter {
  #pluginUuid;
  #connectSeam;
  #randomBytes;
  #socket = null;
  #key = "";
  #upgraded = false;
  #finished = false;
  #errorEmitted = false;
  #closeEmitted = false;
  #upgradeBuffer = Buffer.alloc(0);
  #frameBuffer = Buffer.alloc(0);

  // Seams are injected for tests; production defaults resolve to built-ins.
  constructor({ pluginUuid, connect = defaultConnect, randomBytes = crypto.randomBytes } = {}) {
    super();
    if (typeof pluginUuid !== "string" || pluginUuid.length === 0) {
      throw new TypeError("HostClient requires the plugin UUID");
    }
    this.#pluginUuid = pluginUuid;
    this.#connectSeam = connect;
    this.#randomBytes = randomBytes;
  }

  // Opens the one and only socket with the validated endpoint (A1: no default
  // endpoint exists). Any second call is refused: no reconnect, no fallback.
  connect(endpoint) {
    if (this.#socket || this.#finished) {
      throw new Error("HostClient already owns a socket and never reconnects");
    }
    if (!endpoint || typeof endpoint.address !== "string" || !Number.isInteger(endpoint.port)) {
      throw new TypeError("HostClient.connect requires the validated {address, port} endpoint");
    }
    const socket = this.#connectSeam({ address: endpoint.address, port: endpoint.port });
    if (!socket) throw new TypeError("the connector did not return a socket");
    this.#socket = socket;
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("error", (error) => this.#fail(error));
    socket.on("close", () => this.#onSocketClose());
    socket.once("connect", () => {
      this.#key = this.#randomBytes(16).toString("base64");
      socket.write(createUpgradeRequest({ address: endpoint.address, port: endpoint.port, key: this.#key }));
    });
  }

  // One masked text frame per call. Returns false unless the upgrade is
  // complete and the socket is writable; output is never queued here.
  sendObject(object) {
    if (!this.#upgraded || !this.#socket || !this.#socket.writable) return false;
    this.#socket.write(encodeClientFrame(JSON.stringify(object), { opcode: OP_TEXT, mask: this.#randomBytes(4) }));
    return true;
  }

  // Sends the declared static state for an action context (D3: the only
  // rendering surface this change has). Same false-contract as sendObject:
  // nothing is queued before the upgrade completes or on a dead socket.
  setState(context, stateIndex, text = "") {
    return this.sendObject(createStateCommand(this.#pluginUuid, context, stateIndex, text));
  }

  // Type-1 dynamic image rendering: the proven D200 path for dynamic key content
  // (sibling FlightInfoPlugin). `data` is a self-contained SVG data URI; no file,
  // path or remote URL is ever sent.
  setBaseDataIcon(context, data) {
    return this.sendObject(createImageCommand(this.#pluginUuid, context, data));
  }

  // Standard upstream channel: pushes transient data (the team list) to one key's
  // Property Inspector. The protocol names this command sendtopropertyinspector.
  // The reply must address the key's own action context: the official SDK echoes
  // the decoded context uuid, key and actionid, and the host routes by them. Sending
  // the plugin uuid instead silently drops the message, so the inspector never
  // receives the payload.
  sendToPropertyInspector(context, payload) {
    const { uuid, key, actionid } = decodeContext(context);
    return this.sendObject({ cmd: "sendToPropertyInspector", uuid, key, actionid, payload });
  }

  // Process-disposal seam (SIGINT/SIGTERM): ends dispatch and destroys the
  // owned socket, if any. Idempotent — the once-only close/error guards keep
  // the terminal events single-shot, and no reconnect ever follows.
  dispose() {
    this.#finished = true;
    this.#destroySocket();
  }

  #onData(chunk) {
    if (this.#finished) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (!this.#upgraded) {
      this.#upgradeBuffer = Buffer.concat([this.#upgradeBuffer, buffer]);
      let parsed;
      try {
        parsed = parseUpgradeResponse(this.#upgradeBuffer, this.#key);
      } catch (error) {
        this.#fail(error); // invalid upgrade: destroy before any connected payload
        return;
      }
      if (parsed === null) return; // headers incomplete: keep accumulating
      this.#upgraded = true;
      this.#frameBuffer = parsed.remainder;
      this.sendObject({ cmd: "connected", uuid: this.#pluginUuid, code: 0 });
      this.emit("connected");
      this.#processFrames(); // post-header bytes may already hold whole frames
      return;
    }
    this.#frameBuffer = Buffer.concat([this.#frameBuffer, buffer]);
    this.#processFrames();
  }

  #processFrames() {
    let decoded;
    try {
      decoded = decodeServerFrames(this.#frameBuffer);
    } catch (error) {
      this.#fail(error); // no partial dispatch: the whole batch is discarded
      return;
    }
    this.#frameBuffer = decoded.remainder;
    for (const frame of decoded.frames) {
      if (this.#finished) return;
      if (frame.opcode === OP_TEXT) {
        this.#dispatchRequest(frame.payload);
      } else if (frame.opcode === OP_PING) {
        // Bounded same-socket pong: one exactly-sized masked frame per ping
        // (the codec caps control payloads at 125 bytes).
        this.#socket.write(encodeClientFrame(frame.payload, { opcode: OP_PONG, mask: this.#randomBytes(4) }));
      } else if (frame.opcode === OP_CLOSE) {
        this.#finished = true; // close ends dispatch
        this.#destroySocket(); // the socket 'close' path emits 'close' once
        return;
      }
      // Decoded server pongs carry nothing to answer and are ignored.
    }
  }

  #dispatchRequest(payload) {
    let message;
    try {
      message = JSON.parse(payload.toString("utf8"));
    } catch {
      return; // malformed JSON: no mutation, no response loop
    }
    if (message === null || typeof message !== "object" || Array.isArray(message)) return;
    if (typeof message.cmd !== "string" || message.cmd.length === 0) return; // not a request
    if (message.code !== undefined) return; // a response is never re-answered
    // Same-socket acknowledgement of the request envelope before dispatch (A2).
    this.#socket.write(encodeClientFrame(JSON.stringify(createAck(message, this.#pluginUuid)), { opcode: OP_TEXT, mask: this.#randomBytes(4) }));
    if (message.cmd === "add" || message.cmd === "run" || message.cmd === "paramfromplugin" || message.cmd === "didReceiveSettings" || message.cmd === "sendToPlugin") {
      this.emit(message.cmd, { ...message, context: encodeContext(message) });
      return;
    }
    if (message.cmd === "clear" && Array.isArray(message.param)) {
      const param = message.param.map((item) =>
        item && typeof item === "object" && !Array.isArray(item) ? { ...item, context: encodeContext(item) } : item,
      );
      this.emit("clear", { ...message, param });
    }
    // Any other valid request is acknowledged and left to the host contract.
  }

  // Terminal boundary, surfaced once per client: one error, then disposal.
  // No reconnect, no endpoint fallback, no second connector call ever.
  #fail(error) {
    if (this.#errorEmitted || this.#finished) return;
    this.#errorEmitted = true;
    this.#finished = true;
    this.emit("error", error);
    this.#destroySocket(); // the socket 'close' path emits 'close' once
  }

  #onSocketClose() {
    if (this.#closeEmitted) return;
    this.#closeEmitted = true;
    this.#finished = true;
    this.emit("close");
  }

  #destroySocket() {
    if (this.#socket && typeof this.#socket.destroy === "function") this.#socket.destroy();
  }
}

// RFC 6455 §5.2 opcodes this codec understands.
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
const CONTROL_OPCODES = new Set([OP_CLOSE, OP_PING, OP_PONG]);

// Design boundary DA3: a single frame payload is capped at 1 MiB, and the cap
// is checked from the frame header alone — before any payload allocation and
// before the payload bytes have even arrived.
const MAX_FRAME_PAYLOAD_BYTES = 1024 * 1024;

// RFC 6455 §5.2-§5.3 client frame. The client never fragments and every
// client frame is masked (DA4), so the 4-byte mask is mandatory. The output
// is one exactly-sized buffer per call (payload + ≤14 header bytes); nothing
// is accumulated or queued here — write queueing stays with the future
// socket owner, which must never queue unbounded output.
function encodeClientFrame(payload, { opcode = OP_TEXT, mask } = {}) {
  if (!Buffer.isBuffer(mask) || mask.length !== 4) {
    throw new TypeError("encodeClientFrame requires a 4-byte client mask");
  }
  const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  if (!Buffer.isBuffer(data)) {
    throw new TypeError("encodeClientFrame payload must be a string or Buffer");
  }
  const headerLength = data.length <= 125 ? 2 : data.length <= 0xffff ? 4 : 10;
  const frame = Buffer.alloc(headerLength + 4 + data.length);
  frame[0] = 0x80 | opcode; // FIN + opcode; the client never fragments
  frame[1] = 0x80 | (headerLength === 2 ? data.length : headerLength === 4 ? 126 : 127);
  if (headerLength === 4) frame.writeUInt16BE(data.length, 2);
  if (headerLength === 10) frame.writeBigUInt64BE(BigInt(data.length), 2);
  mask.copy(frame, headerLength);
  for (let i = 0; i < data.length; i += 1) {
    frame[headerLength + 4 + i] = data[i] ^ mask[i % 4];
  }
  return frame;
}

// RFC 6455 §5.2 server-frame decoder (DA3/DA4). Returns every complete frame
// found in `buffer` in order plus the unconsumed tail, so callers retain
// partial frames across TCP chunks by concatenating `remainder` with the next
// chunk. A close frame ends dispatch: nothing after it is ever decoded and
// any trailing bytes are dropped. Invalid structure throws ProtocolError
// before any frame is returned, so a malformed stream can never be partially
// dispatched. Server frames must be unmasked (DA4); text/binary fragmentation
// and payloads above the 1 MiB cap are rejected — the cap is checked from the
// header alone, before allocation. Payload bytes are returned as copies, and
// JSON/UTF-8 validity stays with the dispatch layer by design.
function decodeServerFrames(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("decodeServerFrames expects a Buffer");
  }
  const frames = [];
  let offset = 0;
  const incomplete = () => ({ frames, remainder: Buffer.from(buffer.subarray(offset)) });
  while (offset < buffer.length) {
    if (buffer.length - offset < 2) return incomplete();
    const fin = (buffer[offset] & 0x80) !== 0;
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    const declaredLength = buffer[offset + 1] & 0x7f;
    const headerLength = declaredLength === 126 ? 4 : declaredLength === 127 ? 10 : 2;
    if ((buffer[offset] & 0x70) !== 0) {
      throw new ProtocolError("protocol error: reserved frame bits set");
    }
    if (masked) {
      throw new ProtocolError("protocol error: server frames must not be masked");
    }
    if (CONTROL_OPCODES.has(opcode)) {
      if (!fin) throw new ProtocolError("protocol error: fragmented control frame");
      if (declaredLength > 125) {
        throw new ProtocolError("protocol error: control frame payload exceeds 125 bytes");
      }
    } else if (opcode === OP_TEXT || opcode === OP_BINARY) {
      if (!fin) throw new ProtocolError("protocol error: fragmented data frames are not supported");
      if (opcode === OP_BINARY) {
        throw new ProtocolError("protocol error: binary frames are not supported");
      }
    } else if (opcode === 0x0) {
      throw new ProtocolError("protocol error: continuation frames are not supported");
    } else {
      throw new ProtocolError("protocol error: unsupported frame opcode");
    }
    if (buffer.length - offset < headerLength) return incomplete();
    let payloadLength = declaredLength;
    if (headerLength === 4) payloadLength = buffer.readUInt16BE(offset + 2);
    if (headerLength === 10) payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
    if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
      throw new ProtocolError("protocol error: frame payload exceeds the 1 MiB cap");
    }
    if (buffer.length - offset < headerLength + payloadLength) return incomplete();
    const payloadStart = offset + headerLength;
    frames.push({
      fin,
      opcode,
      payload: Buffer.from(buffer.subarray(payloadStart, payloadStart + payloadLength)),
    });
    offset = payloadStart + payloadLength;
    if (opcode === OP_CLOSE) return { frames, remainder: Buffer.alloc(0) };
  }
  return { frames, remainder: Buffer.alloc(0) };
}

// A2: the action-instance context format used across the host protocol.
function encodeContext({ uuid, key, actionid }) {
  return `${uuid}___${key}___${actionid}`;
}

// Inverse of encodeContext. A context must carry exactly three non-empty
// components; anything else is a malformed host value, never a guessable one.
function decodeContext(context) {
  if (typeof context !== "string") {
    throw new RangeError("malformed action context: expected a string");
  }
  const parts = context.split("___");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new RangeError("malformed action context: expected exactly three non-empty ___ components");
  }
  return { uuid: parts[0], key: parts[1], actionid: parts[2] };
}

// A2: a valid request is acknowledged under the same cmd as the request
// envelope with code: 0; fields needed by the host are preserved.
function createAck(request, pluginUuid) {
  if (typeof pluginUuid !== "string" || pluginUuid.length === 0) {
    throw new TypeError("createAck requires the plugin UUID");
  }
  if (!request || typeof request !== "object" || Array.isArray(request) || typeof request.cmd !== "string" || request.cmd.length === 0) {
    throw new TypeError("createAck requires a request object with a cmd");
  }
  return { ...request, code: 0 };
}

// D3: the only rendering path in this change — the legacy type-0 static state
// command with the exact payload fixed by the design. There is no path,
// base64, title or image variant, and the index must be a legal non-negative
// integer before anything is encoded.
function createStateCommand(pluginUuid, context, stateIndex, text = "") {
  if (typeof pluginUuid !== "string" || pluginUuid.length === 0) {
    throw new TypeError("createStateCommand requires the plugin UUID");
  }
  if (!Number.isInteger(stateIndex) || stateIndex < 0) {
    throw new RangeError(`state index must be a non-negative integer, got ${String(stateIndex)}`);
  }
  if (typeof text !== "string") throw new TypeError("state text must be a string");
  const { uuid, key, actionid } = decodeContext(context);
  return {
    cmd: "state",
    uuid: pluginUuid,
    param: {
      statelist: [{ uuid, key, actionid, type: 0, state: stateIndex, textData: text, showtext: text.length > 0 }],
    },
  };
}

// Type-1 state command: statelist carries the base64 data payload instead of a
// manifest state index. Shape fixed by the sibling D200 plugin implementation.
function createImageCommand(pluginUuid, context, data) {
  if (typeof pluginUuid !== "string" || pluginUuid.length === 0) {
    throw new TypeError("createImageCommand requires the plugin UUID");
  }
  if (typeof data !== "string" || !data.startsWith("data:image/svg+xml;base64,")) {
    throw new TypeError("createImageCommand requires an SVG data URI");
  }
  const { uuid, key, actionid } = decodeContext(context);
  return {
    cmd: "state",
    uuid: pluginUuid,
    param: { statelist: [{ uuid, key, actionid, type: 1, data, textData: "", showtext: false }] },
  };
}

module.exports = {
  HostClient,
  createImageCommand,
  LaunchArgsError,
  ProtocolError,
  UpgradeError,
  connectWithLaunchArgs,
  createAck,
  createUpgradeRequest,
  createStateCommand,
  decodeContext,
  decodeServerFrames,
  encodeClientFrame,
  encodeContext,
  parseLaunchArgs,
  parseUpgradeResponse,
};
