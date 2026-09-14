"use strict";

// Slice 1 toolchain gate: pure validators exported by scripts/check.mjs.
// The check script is ESM while the plugin runtime stays CommonJS (D1), so
// every test loads it through Node's dynamic import (cached after first use).

const assert = require("node:assert/strict");
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const test = require("node:test");

const loadCheck = () => import("../scripts/check.mjs");

test("the inspector restores saved settings explicitly and has no manual match date", () => {
  const html = nodeFs.readFileSync(nodePath.join(__dirname, "..", "com.ulanzi.sportboard.ulanziPlugin", "property-inspector", "inspector.html"), "utf8");
  assert.doesNotMatch(html, /name=["']date["']/);
  assert.doesNotMatch(html, /Match date/);
  assert.match(html, /onConnected[\s\S]*getSettings/);
  assert.match(html, /onDidReceiveSettings/);
  assert.match(html, /message\?\.settings/);
  assert.match(html, /\$UD\.setSettings\(currentSelection\(\)\)/);
  assert.doesNotMatch(html, /\$UD\.sendParamFromPlugin\(/);
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PLUGIN_UUID = "com.ulanzi.ulanzistudio.sportboard";
const ACTION_UUID = `${PLUGIN_UUID}.status`;
const ASSET_NAMES = ["plugin.png", "action.png", "ready.png", "selected.png"];
const BANNER_NAME = "banner.png";
const SCORE_SOUND_NAME = "score-change.wav";

function validScoreSound() {
  const wav = Buffer.alloc(2044);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24);
  wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(wav.length - 44, 40);
  return wav;
}

function baseManifest() {
  return {
    Author: "SportBoardPlugin Contributors",
    Name: "Sport Board",
    Description: "Football match scores and fixtures for your Ulanzi D200.",
    Detail:
      "Sport Board displays the football match nearest to the current time for a team assigned to each Ulanzi D200 key. Select a competition and team, then view home and away crests, team names, kickoff time, score, match date, and a LIVE badge directly on the device. Match-day information refreshes every two minutes until the fixture reaches a terminal state, and pressing the key triggers a manual refresh. Score changes during live play produce a short alert on the computer. A football-data.org API token is required, and competition and fixture availability depends on the account plan.",
    Category: "Sports",
    Icon: "assets/plugin.png",
    CategoryIcon: "assets/plugin.png",
    Banner: ["assets/banners/banner.png"],
    Version: "0.14.0",
    CodePath: "dist/main.js",
    Type: "JavaScript",
    UUID: PLUGIN_UUID,
    OS: [
      { Platform: "windows", MinimumVersion: "10" },
      { Platform: "mac", MinimumVersion: "12" },
    ],
    Software: { MinVersion: "2.1.4" },
    Actions: [
      {
        Name: "Sport Board Status",
        Icon: "assets/action.png",
        UUID: ACTION_UUID,
        States: [
          { Name: "Ready", Image: "assets/ready.png" },
          { Name: "Selected", Image: "assets/selected.png" },
        ],
        DisableAutomaticStates: true,
        Controllers: ["Keypad"],
        Devices: ["D200"],
      },
    ],
  };
}

function basePackageJson(manifest = baseManifest()) {
  return {
    name: "sportboard-plugin",
    private: true,
    version: manifest.Version,
    engines: { node: ">=20" },
    scripts: {
      check: "node scripts/check.mjs",
      test: "node --test test/*.test.js",
    },
  };
}

// Read-only filesystem adapter over in-memory directories and file heads.
function memoryFs(directories, fileHeads) {
  const has = (map, key) => Object.prototype.hasOwnProperty.call(map, key);
  return {
    listDir: (relative) => (has(directories, relative) ? directories[relative] : null),
    readBytes: (relative, count) =>
      has(fileHeads, relative) ? Buffer.from(fileHeads[relative]).subarray(0, count) : null,
  };
}

function baseFs() {
  return memoryFs(
    {
      "": ["manifest.json", "assets"],
      assets: [...ASSET_NAMES, "banners", "sounds"],
      "assets/banners": [BANNER_NAME],
      "assets/sounds": [SCORE_SOUND_NAME],
    },
    {
      ...Object.fromEntries(ASSET_NAMES.map((name) => [`assets/${name}`, PNG_SIGNATURE])),
      [`assets/banners/${BANNER_NAME}`]: PNG_SIGNATURE,
      [`assets/sounds/${SCORE_SOUND_NAME}`]: validScoreSound(),
    },
  );
}

function rulesOf(defects) {
  return defects.map((item) => item.rule);
}

test("package.json and manifest.json must parse", async () => {
  const { parseJsonFile } = await loadCheck();
  assert.deepEqual(parseJsonFile("package.json", "{}\n").value, {});
  const broken = parseJsonFile("package.json", "{ not json");
  assert.equal(broken.defect.rule, "json-parse");
  assert.equal(broken.defect.path, "package.json");
});

test("a fully valid package metadata and manifest yield no defects", async () => {
  const { validateManifest, validatePackageJson, validateAssets, validatePackageStructure } =
    await loadCheck();
  const manifest = baseManifest();
  const defects = [
    ...validatePackageJson(basePackageJson(manifest), manifest),
    ...validateManifest(manifest),
    ...validateAssets(manifest, baseFs()),
    ...validatePackageStructure(baseFs()),
  ];
  assert.deepEqual(defects, []);
});

test("manifest field gate: missing, unknown and forbidden keys are rejected", async () => {
  const { validateManifest } = await loadCheck();

  const missing = baseManifest();
  delete missing.Author;
  assert.deepEqual(rulesOf(validateManifest(missing)), ["manifest.required-key"]);

  const unknown = baseManifest();
  unknown.Experimental = true;
  assert.deepEqual(rulesOf(validateManifest(unknown)), ["manifest.unknown-key"]);

  for (const key of ["MinimumVersion", "PropertyInspectorPath"]) {
    const forbidden = baseManifest();
    forbidden[key] = "forbidden";
    assert.deepEqual(rulesOf(validateManifest(forbidden)), ["manifest.forbidden-key"], key);
  }

  const inspector = baseManifest();
  inspector.Actions[0].PropertyInspectorPath = "property-inspector/inspector.html";
  assert.deepEqual(rulesOf(validateManifest(inspector)), []);
});

test("publication metadata gate pins marketplace text, paths, platforms and minimum versions", async () => {
  const { validateManifest } = await loadCheck();
  const mutations = [
    ["Description", "Other description", "manifest.description"],
    ["Detail", "Other detail", "manifest.detail"],
    ["Category", "Other", "manifest.category"],
    ["CategoryIcon", "assets/action.png", "manifest.category-icon"],
    ["Banner", ["assets/banner.png"], "manifest.banner"],
    ["OS", [{ Platform: "macOS", MinimumVersion: "12" }], "manifest.os"],
    ["Software", { MinVersion: "2.1.3" }, "manifest.software"],
  ];
  for (const [key, value, rule] of mutations) {
    const manifest = baseManifest();
    manifest[key] = value;
    assert.deepEqual(rulesOf(validateManifest(manifest)), [rule], key);
  }
});

test("identity gate: plugin UUID shape and extending action UUID", async () => {
  const { validateManifest } = await loadCheck();

  const threeSegments = baseManifest();
  threeSegments.UUID = "com.ulanzi.sportboard";
  threeSegments.Actions[0].UUID = `${threeSegments.UUID}.status`;
  assert.deepEqual(rulesOf(validateManifest(threeSegments)), ["manifest.uuid-shape"]);

  const fiveSegments = baseManifest();
  fiveSegments.UUID = `${PLUGIN_UUID}.extra`;
  fiveSegments.Actions[0].UUID = `${fiveSegments.UUID}.status`;
  assert.deepEqual(rulesOf(validateManifest(fiveSegments)), ["manifest.uuid-shape"]);

  const detached = baseManifest();
  detached.Actions[0].UUID = "com.ulanzi.other.status";
  assert.deepEqual(rulesOf(validateManifest(detached)), ["action.uuid-extension"]);

  const equal = baseManifest();
  equal.Actions[0].UUID = PLUGIN_UUID;
  assert.deepEqual(rulesOf(validateManifest(equal)), ["action.uuid-extension"]);
});

test("package metadata gate: version drift, engines, scripts and dependency sets", async () => {
  const { validatePackageJson } = await loadCheck();
  const manifest = baseManifest();

  const drifted = basePackageJson(manifest);
  drifted.version = "0.2.0";
  assert.deepEqual(rulesOf(validatePackageJson(drifted, manifest)), ["package.version-drift"]);

  const oldNode = basePackageJson(manifest);
  oldNode.engines.node = ">=18";
  assert.deepEqual(rulesOf(validatePackageJson(oldNode, manifest)), ["package.engines-node"]);

  const wrongScript = basePackageJson(manifest);
  wrongScript.scripts.test = "node --test";
  assert.deepEqual(rulesOf(validatePackageJson(wrongScript, manifest)), ["package.scripts"]);

  const withDependency = basePackageJson(manifest);
  withDependency.dependencies = { ws: "^8.18.0" };
  assert.deepEqual(rulesOf(validatePackageJson(withDependency, manifest)), ["package.dependencies"]);
});

test("release metadata is pinned to version 0.14.0", () => {
  const packageJson = JSON.parse(repoRead("package.json"));
  const manifest = JSON.parse(repoRead("com.ulanzi.sportboard.ulanziPlugin/manifest.json"));
  assert.equal(packageJson.version, "0.14.0");
  assert.equal(manifest.Version, "0.14.0");
});

test("exactly one D200 keypad action is required", async () => {
  const { validateManifest } = await loadCheck();

  const none = baseManifest();
  none.Actions = [];
  assert.deepEqual(rulesOf(validateManifest(none)), ["manifest.actions-count"]);

  const two = baseManifest();
  two.Actions.push({ ...two.Actions[0], UUID: `${PLUGIN_UUID}.second` });
  assert.deepEqual(rulesOf(validateManifest(two)), ["manifest.actions-count"]);

  const wrongDevice = baseManifest();
  wrongDevice.Actions[0].Devices = ["D205"];
  assert.deepEqual(rulesOf(validateManifest(wrongDevice)), ["action.devices"]);

  const wrongControllers = baseManifest();
  wrongControllers.Actions[0].Controllers = ["Encoder"];
  assert.deepEqual(rulesOf(validateManifest(wrongControllers)), ["action.controllers"]);
});

test("the action declares exactly the two committed static states", async () => {
  const { validateManifest } = await loadCheck();

  const oneState = baseManifest();
  oneState.Actions[0].States = [oneState.Actions[0].States[0]];
  assert.deepEqual(rulesOf(validateManifest(oneState)), ["action.states"]);

  const renamed = baseManifest();
  renamed.Actions[0].States[1].Name = "Pressed";
  assert.deepEqual(rulesOf(validateManifest(renamed)), ["action.states"]);

  const noImage = baseManifest();
  delete noImage.Actions[0].States[0].Image;
  assert.deepEqual(rulesOf(validateManifest(noImage)), ["action.states"]);

  const automatic = baseManifest();
  automatic.Actions[0].DisableAutomaticStates = false;
  assert.deepEqual(rulesOf(validateManifest(automatic)), ["action.disable-automatic-states"]);
});

test("asset gate: missing, mis-cased, escaping and non-PNG references fail", async () => {
  const { validateAssets } = await loadCheck();

  const missingReady = baseManifest();
  const missingFs = memoryFs(
    {
      assets: ["plugin.png", "action.png", "selected.png", "banners"],
      "assets/banners": [BANNER_NAME],
    },
    {
      "assets/plugin.png": PNG_SIGNATURE,
      "assets/action.png": PNG_SIGNATURE,
      "assets/selected.png": PNG_SIGNATURE,
      [`assets/banners/${BANNER_NAME}`]: PNG_SIGNATURE,
    },
  );
  const missingDefects = validateAssets(missingReady, missingFs);
  assert.deepEqual(rulesOf(missingDefects), ["asset.missing"]);
  assert.equal(missingDefects[0].path, "assets/ready.png");

  const misCased = baseManifest();
  misCased.Actions[0].States[0].Image = "assets/Ready.png";
  assert.deepEqual(rulesOf(validateAssets(misCased, baseFs())), ["asset.case-mismatch"]);

  const traversal = baseManifest();
  traversal.Icon = "assets/../secrets.png";
  assert.deepEqual(rulesOf(validateAssets(traversal, baseFs())), ["asset.path-safety"]);

  const dataUri = baseManifest();
  dataUri.Actions[0].Icon = "data:image/png;base64,AAAA";
  assert.deepEqual(rulesOf(validateAssets(dataUri, baseFs())), ["asset.path-safety"]);

  const svg = baseManifest();
  svg.Actions[0].States[1].Image = "assets/selected.svg";
  assert.deepEqual(rulesOf(validateAssets(svg, baseFs())), ["asset.png-extension"]);

  const notPng = baseManifest();
  const fakeHeadFs = memoryFs(
    { assets: [...ASSET_NAMES, "banners"], "assets/banners": [BANNER_NAME] },
    {
      ...Object.fromEntries(ASSET_NAMES.map((name) => [`assets/${name}`, PNG_SIGNATURE])),
      "assets/plugin.png": Buffer.from([0x00]),
      [`assets/banners/${BANNER_NAME}`]: PNG_SIGNATURE,
    },
  );
  assert.deepEqual(rulesOf(validateAssets(notPng, fakeHeadFs)), ["asset.png-signature"]);

  const missingBannerFs = memoryFs(
    { assets: [...ASSET_NAMES, "banners"], "assets/banners": [] },
    Object.fromEntries(ASSET_NAMES.map((name) => [`assets/${name}`, PNG_SIGNATURE])),
  );
  const missingBannerDefects = validateAssets(baseManifest(), missingBannerFs);
  assert.deepEqual(rulesOf(missingBannerDefects), ["asset.missing"]);
  assert.equal(missingBannerDefects[0].path, "assets/banners/banner.png");
});

test("no property-inspector directory may exist in the package", async () => {
  const { validatePackageStructure } = await loadCheck();
  assert.deepEqual(rulesOf(validatePackageStructure(baseFs())), []);

  const withInspector = memoryFs(
    { "": ["manifest.json", "assets", "property-inspector"], "assets/sounds": [SCORE_SOUND_NAME] },
    { [`assets/sounds/${SCORE_SOUND_NAME}`]: validScoreSound() },
  );
  assert.deepEqual(rulesOf(validatePackageStructure(withInspector)), []);
});

test("package structure requires a bounded mono PCM score alert WAV", async () => {
  const { validatePackageStructure } = await loadCheck();
  const missing = memoryFs({ "": ["manifest.json", "assets"], assets: [] }, {});
  assert.deepEqual(rulesOf(validatePackageStructure(missing)), ["asset.missing"]);

  const malformed = memoryFs(
    { "assets/sounds": [SCORE_SOUND_NAME] },
    { [`assets/sounds/${SCORE_SOUND_NAME}`]: Buffer.alloc(44) },
  );
  assert.deepEqual(rulesOf(validatePackageStructure(malformed)), ["asset.wav-format"]);
});

test("the committed repository tree passes its own check gate", async () => {
  const { collectDefects } = await loadCheck();
  assert.deepEqual(collectDefects(), []);
});

// -----------------------------------------------------------------------
// Slice 4: build seam (4.1/4.2), ZIP seams (4.3/4.4) and README gate (4.6).
// Both scripts are ESM with injected filesystem seams, so tests stay on
// in-memory trees and never write to the real repository (same pattern as
// the check validators above).

const loadBuild = () => import("../scripts/build.mjs");
const loadPackage = () => import("../scripts/package.mjs");
const repoRead = (name) =>
  require("node:fs").readFileSync(require("node:path").join(__dirname, "..", name));

// In-memory POSIX-style tree implementing the fs seam shared by both
// scripts. `ops` records every mutating call so tests can assert cleanup.
function memoryTree(initialFiles = {}) {
  const parentOf = (p) => {
const cut = p.lastIndexOf("/");
return cut === -1 ? "" : p.slice(0, cut);
  };
  const files = new Map();
  const dirs = new Set([""]);
  const ops = [];
  const addParents = (p) => {
for (let d = parentOf(p); d !== ""; d = parentOf(d)) dirs.add(d);
  };
  const childrenOf = (p) => {
const names = new Set();
const strip = (key) => key.slice(p === "" ? 0 : p.length + 1);
for (const key of dirs) if (key !== "" && parentOf(key) === p) names.add(strip(key));
for (const key of files.keys()) if (parentOf(key) === p) names.add(strip(key));
return [...names].sort();
  };
  for (const [p, value] of Object.entries(initialFiles)) {
files.set(p, Buffer.from(value));
addParents(p);
  }
  return {
ops,
listDir: (p) => (dirs.has(p) ? childrenOf(p) : null),
readFile: (p) => files.get(p) ?? null,
writeFile: (p, data) => {
  ops.push(["write", p]);
  files.set(p, Buffer.from(data));
  addParents(p);
},
mkdir: (p) => {
  ops.push(["mkdir", p]);
  dirs.add(p);
},
rename: (from, to) => {
  ops.push(["rename", from, to]);
  const prefix = `${from}/`;
  for (const [key, data] of [...files]) {
    if (key === from || key.startsWith(prefix)) {
      files.delete(key);
      files.set(key === from ? to : `${to}/${key.slice(prefix.length)}`, data);
    }
  }
  for (const key of [...dirs]) {
    if (key === from || key.startsWith(prefix)) {
      dirs.delete(key);
      dirs.add(key === from ? to : `${to}/${key.slice(prefix.length)}`);
    }
  }
  addParents(to);
},
rm: (p) => {
  ops.push(["rm", p]);
  const prefix = `${p}/`;
  for (const key of [...files.keys()]) if (key === p || key.startsWith(prefix)) files.delete(key);
  for (const key of [...dirs]) if (key === p || key.startsWith(prefix)) dirs.delete(key);
},
  };
}

test("build stages exactly the runtime files byte-for-byte and drops stale dist entries", async () => {
  const { buildDist, EXPECTED_RUNTIME_FILES } = await loadBuild();
  const sources = {
"src/action-runtime.js": "action runtime bytes",
"src/catalog-cache.js": "catalog cache bytes",
"src/team-runtime.js": "team runtime bytes",
"src/team-catalog.js": "team catalog bytes",
"src/host-client.js": "host client bytes",
"src/main.js": "main bytes",
"src/score-alert.js": "score alert bytes",
"src/score-service.js": "score service bytes",
"src/score-image.js": "score image bytes",
  };
  const tree = memoryTree({
...sources,
"pkg/dist/stale.js": "stale bytes",
"pkg/dist/main.js": "outdated bytes",
  });
  const result = buildDist({ srcDir: "src", distDir: "pkg/dist", fs: tree });
  assert.deepEqual(result.copied, EXPECTED_RUNTIME_FILES);
  assert.deepEqual(tree.listDir("pkg/dist"), EXPECTED_RUNTIME_FILES, "no stale or extra file survives");
  for (const name of EXPECTED_RUNTIME_FILES) {
assert.ok(tree.readFile(`pkg/dist/${name}`).equals(Buffer.from(sources[`src/${name}`])), name);
  }
  assert.equal(tree.listDir("pkg/dist.staging"), null, "staging is gone after a completed build");
});

test("build refuses an unexpected source file before staging or touching dist", async () => {
  const { buildDist } = await loadBuild();
  const tree = memoryTree({
"src/action-runtime.js": "a",
"src/host-client.js": "b",
"src/main.js": "c",
"src/score-service.js": "d",
"src/extra.js": "unexpected",
"pkg/dist/main.js": "previous bytes",
  });
  assert.throws(() => buildDist({ srcDir: "src", distDir: "pkg/dist", fs: tree }), /expected exactly/);
  assert.deepEqual(tree.listDir("pkg/dist"), ["main.js"], "previous dist must stay untouched");
  assert.equal(tree.listDir("pkg/dist.staging"), null);
});

test("build removes its staging directory on a mid-copy failure and leaves dist untouched", async () => {
  const { buildDist } = await loadBuild();
  const tree = memoryTree({
"src/action-runtime.js": "a",
"src/team-runtime.js": "b",
"src/host-client.js": "c",
"src/main.js": "d",
"src/score-alert.js": "i",
"src/score-service.js": "e",
"src/score-image.js": "f",
"src/team-catalog.js": "g",
"src/catalog-cache.js": "h",
"pkg/dist/main.js": "previous bytes",
  });
  const failing = {
...tree,
writeFile: (p, data) => {
  if (p === "pkg/dist.staging/host-client.js") throw new Error("simulated write failure");
  return tree.writeFile(p, data);
},
  };
  assert.throws(() => buildDist({ srcDir: "src", distDir: "pkg/dist", fs: failing }), /simulated write failure/);
  assert.equal(tree.listDir("pkg/dist.staging"), null, "staging removed after failure");
  assert.ok(tree.readFile("pkg/dist/main.js").equals(Buffer.from("previous bytes")));
});

test("the committed src/plugin tree matches the build manifest exactly", async () => {
  const { EXPECTED_RUNTIME_FILES } = await loadBuild();
  const listing = require("node:fs")
.readdirSync(require("node:path").join(__dirname, "..", "src/plugin"))
.sort();
  assert.deepEqual(listing, EXPECTED_RUNTIME_FILES);
});

function fixturePackage() {
  return {
"pkg/manifest.json": "{}\n",
"pkg/assets/plugin.png": "plugin png bytes",
"pkg/assets/action.png": "action png bytes",
"pkg/assets/ready.png": "ready png bytes",
"pkg/assets/selected.png": "selected png bytes",
"pkg/assets/sounds/score-change.wav": validScoreSound(),
"pkg/dist/action-runtime.js": "a",
"pkg/dist/host-client.js": "b",
"pkg/dist/main.js": "c",
"pkg/dist/score-service.js": "d",
  };
}

test("crc32 matches the published CRC-32 check values", async () => {
  const { crc32 } = await loadPackage();
  assert.equal(crc32(Buffer.alloc(0)), 0x00000000);
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("collectEntries yields sorted prefixed names with manifest at the plugin-folder root", async () => {
  const { collectEntries, PLUGIN_FOLDER } = await loadPackage();
  const entries = collectEntries({ pluginDir: "pkg", fs: memoryTree(fixturePackage()) });
  const names = entries.map((entry) => entry.name);
  assert.equal(names.length, 10);
  assert.ok(names.every((name) => name.startsWith(`${PLUGIN_FOLDER}/`)));
  assert.deepEqual(names, [...names].sort());
  assert.equal(names[0], `${PLUGIN_FOLDER}/assets/action.png`);
  assert.ok(names.includes(`${PLUGIN_FOLDER}/manifest.json`), "manifest sits at the plugin-folder root");
  assert.ok(names.includes(`${PLUGIN_FOLDER}/assets/sounds/score-change.wav`), "score alert WAV is packaged");
  const manifest = entries.find((entry) => entry.name === `${PLUGIN_FOLDER}/manifest.json`);
  assert.ok(manifest.data.equals(Buffer.from("{}\n")), "entry bytes are copied unmodified");
});

test("collectEntries excludes generated package output directories", async () => {
  const { collectEntries } = await loadPackage();
  const tree = memoryTree({
...fixturePackage(),
"pkg/package/com.ulanzi.sportboard.ulanziPlugin.zip": "old zip",
"pkg/dist.staging/main.js": "interrupted build",
  });
  const names = collectEntries({ pluginDir: "pkg", fs: tree }).map((entry) => entry.name);
  assert.ok(!names.some((name) => name.includes("/package/") || name.includes("/dist.staging/")));
});

test("collectEntries rejects traversal and absolute entry names", async () => {
  const { collectEntries } = await loadPackage();
  const base = memoryTree(fixturePackage());
  const withListing = (name) => ({
...base,
listDir: (p) => (p === "pkg" ? [name] : base.listDir(p)),
  });
  for (const hostile of ["../evil.txt", "/abs.txt", "a\\b.txt"]) {
assert.throws(() => collectEntries({ pluginDir: "pkg", fs: withListing(hostile) }), /unsafe entry name/, hostile);
  }
});

test("createZip emits fixed-metadata ZIP32 store headers", async () => {
  const { createZip, crc32, PLUGIN_FOLDER } = await loadPackage();
  const name = `${PLUGIN_FOLDER}/manifest.json`;
  const data = Buffer.from("{}\n");
  const zip = createZip([{ name, data }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt16LE(4), 20, "version needed 2.0");
  assert.equal(zip.readUInt16LE(6), 0, "no general-purpose flags");
  assert.equal(zip.readUInt16LE(8), 0, "stored, not compressed");
  assert.equal(zip.readUInt16LE(10), 0, "fixed DOS time");
  assert.equal(zip.readUInt16LE(12), 0x0021, "fixed DOS date 1980-01-01");
  assert.equal(zip.readUInt32LE(14), crc32(data));
  assert.equal(zip.readUInt32LE(18), data.length);
  assert.equal(zip.readUInt32LE(22), data.length);
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.equal(zip.readUInt16LE(central + 4), 20, "version made by");
  assert.equal(zip.readUInt16LE(central + 8), 0);
  assert.equal(zip.readUInt16LE(central + 10), 0);
  assert.equal(zip.readUInt16LE(central + 12), 0);
  assert.equal(zip.readUInt16LE(central + 14), 0x0021);
  assert.equal(zip.readUInt32LE(central + 38), (0o100644 << 16) >>> 0, "fixed permissions");
  assert.equal(zip.readUInt32LE(central + 42), 0, "first local header offset");
  const eocd = central + 46 + name.length;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 10), 1, "one entry");
  assert.equal(zip.readUInt32LE(eocd + 12), eocd - central, "central-directory size");
  assert.equal(zip.readUInt32LE(eocd + 16), central, "central-directory offset");
});

test("two runs over an identical tree produce byte-identical archives with no absolute paths", async () => {
  const { collectEntries, createZip } = await loadPackage();
  const run = () => createZip(collectEntries({ pluginDir: "pkg", fs: memoryTree(fixturePackage()) }));
  const first = run();
  assert.ok(first.equals(run()));
  assert.ok(!first.includes(Buffer.from(process.cwd())), "no environment-specific absolute path");
});

test("createZip rejects unsafe names and ZIP64-sized inputs instead of guessing", async () => {
  const { createZip, PLUGIN_FOLDER } = await loadPackage();
  for (const name of ["../evil.txt", "/abs.txt", "a\\b.txt", `${PLUGIN_FOLDER}/../x`]) {
assert.throws(() => createZip([{ name, data: Buffer.alloc(1) }]), /unsafe entry name/, name);
  }
  const oversized = { name: `${PLUGIN_FOLDER}/big.bin`, data: { length: 0xffffffff + 1 } };
  assert.throws(() => createZip([oversized]), /ZIP64/);
  const half = { length: 0x80000000 };
  assert.throws(
() => createZip([
  { name: `${PLUGIN_FOLDER}/a.bin`, data: half },
  { name: `${PLUGIN_FOLDER}/b.bin`, data: half },
]),
/ZIP64/,
"combined size also rejects",
  );
});

test("zip layout verification pins the rooted central directory", async () => {
  const { createZip, verifyZipLayout, PLUGIN_FOLDER } = await loadPackage();
  const name = `${PLUGIN_FOLDER}/manifest.json`;
  const zip = createZip([{ name, data: Buffer.from("{}\n") }]);
  assert.deepEqual(verifyZipLayout(zip, [name]), [name]);
  const tampered = Buffer.from(zip);
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.equal(tampered[central + 46], 0x63); // sanity: "c" of "com.ulanzi..." at the central name
  tampered[central + 46] = 0x58; // "c" -> "X"
  assert.throws(() => verifyZipLayout(tampered, [name]), /central-directory/);
});

const README_ANCHORS = [
  "football-data.org",
  "Ulanzi D200",
  "Dynamic competition and team selectors",
  "two minutes",
  "Team crest",
  "setSettings",
  "SHA-256",
  "%APPDATA%",
  "npm run check",
  "npm test",
  "npm run build",
  "npm run package",
  "MIT",
  "not affiliated",
  "Windows 10 or later",
  "macOS 12 or later",
  "pending physical validation",
  "LIVE",
  "played by the computer",
];

test("README documents the public plugin, installation, security and verification", () => {
  const readme = repoRead("README.md").toString("utf8");
  for (const anchor of README_ANCHORS) {
    assert.ok(readme.includes(anchor), `README must contain: ${anchor}`);
  }
  assert.doesNotMatch(readme, /X-Auth-Token\s*[:=]\s*\S+/);
});
