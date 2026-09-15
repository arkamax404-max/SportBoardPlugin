"use strict";

// src/plugin/main.js — process composition (slice 3).
//
// Validates the host launch arguments (A1), builds one HostClient and one
// ActionRuntime around the compile-time identity (DA1/DA2), registers the
// lifecycle handlers before the single connect, disposes on SIGINT/SIGTERM,
// and logs only short lifecycle/error categories to stderr — never raw frames
// or payloads. Runs as a process only under `require.main === module`.

const { HostClient, parseLaunchArgs } = require("./host-client.js");
const { ActionRuntime } = require("./action-runtime.js");
const { TeamRuntime } = require("./team-runtime.js");
const { TeamCatalog } = require("./team-catalog.js");
const { CatalogCache } = require("./catalog-cache.js");
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { FootballDataScoreProvider, ScoreService } = require("./score-service.js");
const { createScoreAlertPlayer } = require("./score-alert.js");

// Compile-time identity (DA1/DA2): one atomic change updates these together
// with the manifest, package metadata, checks and tests.
const PLUGIN_UUID = "com.ulanzi.ulanzistudio.sportboard";
const ACTION_UUID = "com.ulanzi.ulanzistudio.sportboard.status";
const STATE_COUNT = 2;

// The selector lists are cached next to the plugin (dist/main.js runs from
// <pluginRoot>/dist/), so a restart reuses them instead of spending requests.
// Nothing is written outside the plugin folder, and the API token is never stored.
function createCatalogCache(cachePath) {
  return new CatalogCache({
    filePath: cachePath ?? nodePath.join(__dirname, "..", "catalog-cache.json"),
    fs: {
      readFile: (path) => { try { return nodeFs.readFileSync(path, "utf8"); } catch { return null; } },
      writeFile: (path, data) => nodeFs.writeFileSync(path, data),
      rename: (from, to) => nodeFs.renameSync(from, to),
      remove: (path) => nodeFs.rmSync(path, { force: true }),
    },
  });
}

function writeStderr(line) {
  process.stderr.write(`${line}\n`);
}

// Test seam with Node built-in production defaults. Returns the process exit
// status: 1 for invalid launch arguments — before any socket exists — and 0
// once the single connection has been handed to the host endpoint.
// `cachePath` exists so tests can point the cache at a scratch directory: the default
// resolves to <pluginRoot>/catalog-cache.json, which is the plugin folder when
// dist/main.js runs and would otherwise be the source tree under test.
function start({ argv = process.argv, connect, randomBytes, stderr = writeStderr, fetch = globalThis.fetch, cachePath, spawn, platform, scoreSoundPath } = {}) {
  let endpoint;
  try {
    endpoint = parseLaunchArgs(argv);
  } catch {
    stderr("startup failed: invalid launch arguments");
    return 1;
  }
  const client = new HostClient({ pluginUuid: PLUGIN_UUID, connect, randomBytes });
  const runtime = new ActionRuntime({ host: client, actionUuid: ACTION_UUID, stateCount: STATE_COUNT });
  const scores = new ScoreService({ provider: new FootballDataScoreProvider({ fetch }) });
  const scoreAlert = createScoreAlertPlayer({ spawn, platform, soundPath: scoreSoundPath });
  const teams = new TeamRuntime({ host: client, service: scores, alert: scoreAlert.play });
  const catalog = new TeamCatalog({ service: scores, host: client, cache: createCatalogCache(cachePath) });
  // A plugin restart reaches the service as an `add` carrying the saved settings, so
  // this is where the key view and both option lists are restored. The catalog serves
  // the lists from its cache, so a restart normally costs no provider request.
  client.on("add", (event) => {
    runtime.add(event);
    catalog.publish(event);
    teams.refresh(event, { resetMode: "always" });
  });
  // Dynamic content owns the press gesture. Avoid sending a transient static state
  // immediately before the selected fixture view is redrawn.
  client.on("run", (event) => { teams.toggle(event); });
  client.on("clear", (message) => {
    runtime.clear(message);
    teams.clear(message);
  });
  client.on("paramfromplugin", (event) => {
    catalog.publish(event);
    teams.refresh(event);
  });
  // `setSettings` is the durable host storage API. Studio returns those values as
  // didReceiveSettings, whereas paramfromplugin is not reliably retained across an
  // application restart.
  client.on("didReceiveSettings", (event) => {
    const settings = event?.settings ?? event?.param ?? event?.payload?.settings;
    if (!settings || typeof settings !== "object") return;
    const restored = { context: event.context, param: settings };
    catalog.publish(restored);
    teams.refresh(restored, { resetMode: "always" });
  });
  // Transient inspector requests are never merged into the saved settings, so
  // "refresh" cannot become a persisted flag that would bypass the cache on every
  // later load. `sync` re-sends the lists when the inspector page opens; `refresh`
  // additionally ignores the cache.
  client.on("sendToPlugin", (event) => {
    const payload = event?.payload;
    if (!payload || typeof payload !== "object") return;
    if (payload.refresh === true || payload.sync === true) catalog.publish({ context: event.context, param: payload });
  });
  client.on("error", () => stderr("runtime error: host connection failed"));
  client.on("close", () => stderr("runtime lifecycle: host connection closed"));
  const dispose = () => {
    runtime.dispose(); // clear static in-memory state; nothing is persisted
    teams.dispose(); // cancel every per-key match-day poll timer
    scoreAlert.dispose(); // terminate any host-computer sound still playing
    client.dispose(); // destroy the one socket; no reconnect ever follows
  };
  process.once("SIGINT", dispose);
  process.once("SIGTERM", dispose);
  client.connect({ address: endpoint.address, port: endpoint.port });
  return 0;
}

if (require.main === module) {
  process.exitCode = start();
}

module.exports = { ACTION_UUID, PLUGIN_UUID, STATE_COUNT, start };
