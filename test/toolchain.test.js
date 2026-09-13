"use strict";

// Slice 1 toolchain gate: pure validators exported by scripts/check.mjs.
// The check script is ESM while the plugin runtime stays CommonJS (D1), so
// every test loads it through Node's dynamic import (cached after first use).

const assert = require("node:assert/strict");
const test = require("node:test");

const loadCheck = () => import("../scripts/check.mjs");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PLUGIN_UUID = "com.ulanzi.ulanzistudio.sportboard";
const ACTION_UUID = `${PLUGIN_UUID}.status`;
const ASSET_NAMES = ["plugin.png", "action.png", "ready.png", "selected.png"];

function baseManifest() {
  return {
    Author: "SportBoardPlugin Contributors",
    Name: "Sport Board",
    Icon: "assets/plugin.png",
    Version: "0.1.0",
    CodePath: "dist/main.js",
    Type: "JavaScript",
    UUID: PLUGIN_UUID,
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
    { "": ["manifest.json", "assets"], assets: [...ASSET_NAMES] },
    Object.fromEntries(ASSET_NAMES.map((name) => [`assets/${name}`, PNG_SIGNATURE])),
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
  unknown.Category = "Sports";
  assert.deepEqual(rulesOf(validateManifest(unknown)), ["manifest.unknown-key"]);

  for (const key of ["Banner", "Detail", "MinimumVersion", "PropertyInspectorPath"]) {
    const forbidden = baseManifest();
    forbidden[key] = "forbidden";
    assert.deepEqual(rulesOf(validateManifest(forbidden)), ["manifest.forbidden-key"], key);
  }

  const inspector = baseManifest();
  inspector.Actions[0].PropertyInspectorPath = "property-inspector/inspector.html";
  assert.deepEqual(rulesOf(validateManifest(inspector)), ["action.forbidden-key"]);
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
    { assets: ["plugin.png", "action.png", "selected.png"] },
    {
      "assets/plugin.png": PNG_SIGNATURE,
      "assets/action.png": PNG_SIGNATURE,
      "assets/selected.png": PNG_SIGNATURE,
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
    { assets: [...ASSET_NAMES] },
    { ...Object.fromEntries(ASSET_NAMES.map((name) => [`assets/${name}`, PNG_SIGNATURE])), "assets/plugin.png": Buffer.from([0x00]) },
  );
  assert.deepEqual(rulesOf(validateAssets(notPng, fakeHeadFs)), ["asset.png-signature"]);
});

test("no property-inspector directory may exist in the package", async () => {
  const { validatePackageStructure } = await loadCheck();
  assert.deepEqual(rulesOf(validatePackageStructure(baseFs())), []);

  const withInspector = memoryFs({ "": ["manifest.json", "assets", "property-inspector"] }, {});
  assert.deepEqual(rulesOf(validatePackageStructure(withInspector)), ["structure.property-inspector"]);
});

test("the committed repository tree passes its own check gate", async () => {
  const { collectDefects } = await loadCheck();
  assert.deepEqual(collectDefects(), []);
});
