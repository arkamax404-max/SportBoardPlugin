// scripts/check.mjs — read-only package metadata, manifest and asset gate.
//
// Exported validators are pure: they accept in-memory data plus an injected
// read-only filesystem adapter, so tests never touch the real tree. When
// executed directly, every defect is reported in stable path/rule order and
// the process exits non-zero. All paths resolve from import.meta.url.

import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_FOLDER = "com.ulanzi.sportboard.ulanziPlugin";

const REQUIRED_MANIFEST_KEYS = ["Author", "Name", "Icon", "Version", "CodePath", "Type", "UUID", "Actions"];
const ALLOWED_MANIFEST_KEYS = [...REQUIRED_MANIFEST_KEYS, "Software"];
const FORBIDDEN_MANIFEST_KEYS = ["Banner", "Detail", "MinimumVersion", "PropertyInspectorPath"];
const REQUIRED_ACTION_KEYS = ["Name", "Icon", "UUID", "States", "DisableAutomaticStates", "Controllers", "Devices"];
const FORBIDDEN_ACTION_KEYS = ["Banner", "Detail", "MinimumVersion"];
const EXPECTED_CONTROLLERS = ["Keypad"];
const EXPECTED_DEVICES = ["D200"];
const EXPECTED_STATE_NAMES = ["Ready", "Selected"];
const REQUIRED_SCRIPTS = {
  check: "node scripts/check.mjs",
  test: "node --test test/*.test.js",
};
// build/package land with the toolchain slice; validate their exact command when present.
const VALIDATED_OPTIONAL_SCRIPTS = {
  build: "node scripts/build.mjs",
  package: "npm run check && npm test && npm run build && node scripts/package.mjs",
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function defect(path, rule, message) {
  return { path, rule, message };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEquals(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function isPluginUuid(uuid) {
  if (typeof uuid !== "string") return false;
  const segments = uuid.split(".");
  return segments.length === 4 && segments.every((segment) => segment.length > 0);
}

export function parseJsonFile(path, text) {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { defect: defect(path, "json-parse", `invalid JSON (${error.message})`) };
  }
}

export function validatePackageJson(packageJson, manifest) {
  const defects = [];
  if (packageJson.engines?.node !== ">=20") {
    defects.push(defect("package.json", "package.engines-node", 'engines.node must be ">=20"'));
  }
  for (const [name, command] of Object.entries(REQUIRED_SCRIPTS)) {
    if (packageJson.scripts?.[name] !== command) {
      defects.push(defect("package.json", "package.scripts", `scripts.${name} must be "${command}"`));
    }
  }
  for (const [name, command] of Object.entries(VALIDATED_OPTIONAL_SCRIPTS)) {
    const declared = packageJson.scripts?.[name];
    if (declared !== undefined && declared !== command) {
      defects.push(defect("package.json", "package.scripts", `scripts.${name} must be "${command}"`));
    }
  }
  for (const name of ["dependencies", "devDependencies"]) {
    const entries = packageJson[name];
    if (entries !== undefined && Object.keys(entries).length > 0) {
      defects.push(defect("package.json", "package.dependencies", `${name} must be absent or empty (D1)`));
    }
  }
  if (manifest && packageJson.version !== manifest.Version) {
    defects.push(
      defect("package.json", "package.version-drift", `version must equal manifest.json Version (${manifest.Version})`),
    );
  }
  return defects;
}

export function validateManifest(manifest) {
  const defects = [];
  const keys = isPlainObject(manifest) ? Object.keys(manifest) : [];
  for (const key of REQUIRED_MANIFEST_KEYS) {
    if (manifest?.[key] === undefined) {
      defects.push(defect("manifest.json", "manifest.required-key", `missing required field ${key}`));
    }
  }
  for (const key of keys) {
    if (!ALLOWED_MANIFEST_KEYS.includes(key) && !FORBIDDEN_MANIFEST_KEYS.includes(key)) {
      defects.push(defect("manifest.json", "manifest.unknown-key", `undocumented field ${key}`));
    }
  }
  for (const key of FORBIDDEN_MANIFEST_KEYS) {
    if (isPlainObject(manifest) && key in manifest) {
      defects.push(defect("manifest.json", "manifest.forbidden-key", `forbidden field ${key} (A4/D4)`));
    }
  }
  if (isPlainObject(manifest) && "Software" in manifest) {
    const software = manifest.Software;
    if (!isPlainObject(software)) {
      defects.push(defect("manifest.json", "manifest.unknown-key", "Software must be an object"));
    } else {
      for (const key of Object.keys(software)) {
        if (key !== "MinVersion") {
          defects.push(defect("manifest.json", "manifest.unknown-key", `undocumented Software field ${key}`));
        }
      }
    }
  }
  if (manifest?.Type !== undefined && manifest.Type !== "JavaScript") {
    defects.push(defect("manifest.json", "manifest.type", 'Type must be "JavaScript"'));
  }
  if (manifest?.CodePath !== undefined && manifest.CodePath !== "dist/main.js") {
    defects.push(defect("manifest.json", "manifest.code-path", 'CodePath must be "dist/main.js"'));
  }
  if (manifest?.UUID !== undefined && !isPluginUuid(manifest.UUID)) {
    defects.push(defect("manifest.json", "manifest.uuid-shape", `UUID must have exactly 4 non-empty segments`));
  }
  if (manifest?.Actions !== undefined && !Array.isArray(manifest.Actions)) {
    defects.push(defect("manifest.json", "manifest.actions-count", "Actions must be an array"));
  }
  if (Array.isArray(manifest?.Actions) && manifest.Actions.length !== 1) {
    defects.push(
      defect("manifest.json", "manifest.actions-count", `exactly one action is required, found ${manifest.Actions.length}`),
    );
  }
  if (Array.isArray(manifest?.Actions)) {
    manifest.Actions.forEach((action, index) => {
      defects.push(...validateAction(manifest, action, `manifest.json Actions[${index}]`));
    });
  }
  return defects;
}

function validateAction(manifest, action, path) {
  const defects = [];
  const keys = isPlainObject(action) ? Object.keys(action) : [];
  for (const key of REQUIRED_ACTION_KEYS) {
    if (action?.[key] === undefined) {
      defects.push(defect(path, "action.required-key", `missing required action field ${key}`));
    }
  }
  for (const key of keys) {
    if (!REQUIRED_ACTION_KEYS.includes(key) && key !== "PropertyInspectorPath" && !FORBIDDEN_ACTION_KEYS.includes(key)) {
      defects.push(defect(path, "action.unknown-key", `undocumented action field ${key}`));
    }
  }
  for (const key of FORBIDDEN_ACTION_KEYS) {
    if (isPlainObject(action) && key in action) {
      defects.push(defect(path, "action.forbidden-key", `forbidden action field ${key} (A4/D4)`));
    }
  }
  const uuid = action?.UUID;
  const pluginUuid = manifest?.UUID;
  if (
    typeof uuid === "string" &&
    typeof pluginUuid === "string" &&
    !(uuid.startsWith(`${pluginUuid}.`) && uuid.length > pluginUuid.length)
  ) {
    defects.push(defect(path, "action.uuid-extension", `action UUID must extend the plugin UUID "${pluginUuid}"`));
  }
  if (action?.DisableAutomaticStates !== undefined && action.DisableAutomaticStates !== true) {
    defects.push(defect(path, "action.disable-automatic-states", "DisableAutomaticStates must be true; the runtime selects the state"));
  }
  if (action?.Controllers !== undefined && !deepEquals(action.Controllers, EXPECTED_CONTROLLERS)) {
    defects.push(defect(path, "action.controllers", `Controllers must be exactly ${JSON.stringify(EXPECTED_CONTROLLERS)}`));
  }
  if (action?.Devices !== undefined && !deepEquals(action.Devices, EXPECTED_DEVICES)) {
    defects.push(defect(path, "action.devices", `Devices must be exactly ${JSON.stringify(EXPECTED_DEVICES)}`));
  }
  defects.push(...validateStates(action, `${path}.States`));
  return defects;
}

function validateStates(action, path) {
  const defects = [];
  const states = action?.States;
  if (!Array.isArray(states)) return defects; // required-key already reported
  const names = states.map((state) => state?.Name);
  const shaped = states.every(
    (state) =>
      isPlainObject(state) &&
      typeof state.Name === "string" &&
      typeof state.Image === "string" &&
      Object.keys(state).length === 2,
  );
  if (states.length !== EXPECTED_STATE_NAMES.length || !deepEquals(names, EXPECTED_STATE_NAMES) || !shaped) {
    defects.push(
      defect(path, "action.states", `States must be exactly ${EXPECTED_STATE_NAMES.join(", ")} in order, each { Name, Image }`),
    );
  }
  return defects;
}

export function validateAssets(manifest, fs) {
  const defects = [];
  for (const reference of collectAssetReferences(manifest)) {
    defects.push(...validateReference(reference, fs));
  }
  return defects;
}

function collectAssetReferences(manifest) {
  const references = [];
  const push = (path, image) => {
    if (typeof path === "string") references.push({ path, image });
  };
  push(manifest?.CodePath, false);
  push(manifest?.Icon, true);
  for (const action of Array.isArray(manifest?.Actions) ? manifest.Actions : []) {
    push(action?.Icon, true);
    for (const state of Array.isArray(action?.States) ? action.States : []) {
      push(state?.Image, true);
    }
  }
  return references;
}

function validateReference({ path, image }, fs) {
  const normalized = safeRelative(path);
  if (normalized === null) {
    return [defect(path, "asset.path-safety", "path must be relative, without \":\", \"\\\" or \"..\" segments")];
  }
  if (!image) return []; // CodePath existence is verified after build, not here
  if (!normalized.endsWith(".png")) {
    return [defect(path, "asset.png-extension", "image assets must be committed .png files (D3/DA5)")];
  }
  const directory = posix.dirname(normalized);
  const base = posix.basename(normalized);
  const entries = fs.listDir(directory === "." ? "" : directory);
  if (entries === null || !entries.includes(base)) {
    const misCased = (entries ?? []).find((entry) => entry.toLowerCase() === base.toLowerCase());
    return [
      misCased === undefined
        ? defect(path, "asset.missing", "referenced asset does not exist")
        : defect(path, "asset.case-mismatch", `referenced asset exists as "${misCased}" with different casing`),
    ];
  }
  const head = fs.readBytes(normalized, PNG_SIGNATURE.length);
  if (head === null || !head.equals(PNG_SIGNATURE)) {
    return [defect(path, "asset.png-signature", "referenced asset is not a PNG file")];
  }
  return [];
}

function safeRelative(path) {
  if (typeof path !== "string" || path.length === 0) return null;
  if (path.includes("\\") || path.includes(":") || path.startsWith("/")) return null;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

export function validatePackageStructure(fs) {
  const entries = fs.listDir("") ?? [];
  return [];
}

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = fileURLToPath(new URL(`../${PLUGIN_FOLDER}/`, import.meta.url));

function nodeFsAdapter(root) {
  return {
    listDir: (relative) => {
      try {
        return readdirSync(join(root, relative));
      } catch {
        return null;
      }
    },
    readBytes: (relative, count) => {
      try {
        return readFileSync(join(root, relative)).subarray(0, count);
      } catch {
        return null;
      }
    },
  };
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function collectDefects({
  repoRoot: root = repoRoot,
  pluginRoot: packageRoot = pluginRoot,
} = {}) {
  const defects = [];
  const packageText = readText(join(root, "package.json"));
  const manifestText = readText(join(packageRoot, "manifest.json"));
  if (packageText === null) defects.push(defect("package.json", "file-missing", "package.json is missing"));
  if (manifestText === null) defects.push(defect("manifest.json", "file-missing", "manifest.json is missing"));
  const packageParsed = packageText === null ? null : parseJsonFile("package.json", packageText);
  const manifestParsed = manifestText === null ? null : parseJsonFile("manifest.json", manifestText);
  if (packageParsed?.defect) defects.push(packageParsed.defect);
  if (manifestParsed?.defect) defects.push(manifestParsed.defect);
  const packageJson = packageParsed?.value;
  const manifest = manifestParsed?.value;
  if (packageJson) defects.push(...validatePackageJson(packageJson, manifest));
  if (manifest) {
    defects.push(...validateManifest(manifest));
    const fs = nodeFsAdapter(packageRoot);
    defects.push(...validateAssets(manifest, fs));
    defects.push(...validatePackageStructure(fs));
  }
  return defects;
}

export function sortDefects(defects) {
  return [...defects].sort(
    (a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message),
  );
}

export function main() {
  const defects = sortDefects(collectDefects());
  for (const { path, rule, message } of defects) {
    console.error(`${path}: ${rule}: ${message}`);
  }
  if (defects.length > 0) {
    console.error(`check failed with ${defects.length} defect(s).`);
    return 1;
  }
  console.log(`check passed: ${PLUGIN_FOLDER} metadata, manifest and assets are valid.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
