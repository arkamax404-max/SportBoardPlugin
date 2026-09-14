// scripts/build.mjs — deterministic local copy of src/plugin/ into the package
// folder's dist/. It copies bytes only: no transform, bundle, fetch or asset
// generation (DA5/D1). Files stage into a temporary sibling of dist/ and the
// staging directory is atomically renamed over dist/, so repeated builds never
// leave stale runtime files behind and a failed build removes its staging
// directory while a previously completed dist/ stays untouched. Exported seams
// are pure (injected filesystem adapter), so tests never touch the real tree.
// All paths resolve from import.meta.url, never the caller's working directory.

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_FOLDER = "com.ulanzi.sportboard.ulanziPlugin";
export const EXPECTED_RUNTIME_FILES = ["action-runtime.js", "catalog-cache.js", "host-client.js", "main.js", "score-image.js", "score-service.js", "team-catalog.js", "team-runtime.js"];

function fail(message) {
  throw new Error(`build: ${message}`);
}

export function buildDist({ srcDir, distDir, fs }) {
  const listed = fs.listDir(srcDir);
  if (listed === null) fail(`source directory is missing: ${srcDir}`);
  const names = [...listed].sort();
  if (names.join(",") !== EXPECTED_RUNTIME_FILES.join(",")) {
    fail(
      `expected exactly ${EXPECTED_RUNTIME_FILES.join(", ")} in ${srcDir}, ` +
        `found ${names.join(", ") || "nothing"}`,
    );
  }
  const staging = `${distDir}.staging`;
  try {
    fs.mkdir(staging);
    for (const name of names) {
      const data = fs.readFile(`${srcDir}/${name}`);
      if (data === null) fail(`unreadable source file: ${srcDir}/${name}`);
      fs.writeFile(`${staging}/${name}`, data);
    }
    const staged = [...(fs.listDir(staging) ?? [])].sort();
    if (staged.join(",") !== names.join(",")) fail("staged file set does not match the source set");
    if (fs.listDir(distDir) !== null) fs.rm(distDir);
    fs.rename(staging, distDir);
  } catch (error) {
    if (fs.listDir(staging) !== null) fs.rm(staging);
    throw error;
  }
  return { copied: names, distDir };
}

function nodeFs() {
  return {
    listDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return null;
      }
    },
    readFile: (path) => {
      try {
        return readFileSync(path);
      } catch {
        return null;
      }
    },
    writeFile: (path, data) => writeFileSync(path, data),
    mkdir: (path) => mkdirSync(path, { recursive: true }),
    rename: (from, to) => renameSync(from, to),
    rm: (path) => rmSync(path, { recursive: true, force: true }),
  };
}

export function main() {
  try {
    const repoRoot = fileURLToPath(new URL("../", import.meta.url));
    const result = buildDist({
      srcDir: join(repoRoot, "src/plugin"),
      distDir: join(repoRoot, PLUGIN_FOLDER, "dist"),
      fs: nodeFs(),
    });
    console.log(`build: copied ${result.copied.join(", ")} to ${PLUGIN_FOLDER}/dist/.`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
