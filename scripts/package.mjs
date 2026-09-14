// scripts/package.mjs — deterministic ZIP32 "store" writer for the plugin package.
//
// No compression, fixed DOS timestamp/date, flags and permissions: two runs
// over an identical source tree produce byte-identical archives, and no
// environment-specific absolute path or current timestamp is ever emitted.
// Exported seams (crc32, collectEntries, createZip, verifyZipLayout) are pure
// and take injected filesystem adapters, so tests never touch the real tree.
// When executed it collects the built package folder, verifies the rooted
// central directory, then writes <repo>/package/<plugin>.zip via a temporary
// file and rename — a failing run never replaces a prior ZIP. All paths
// resolve from import.meta.url, never the caller's working directory.

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_FOLDER = "com.ulanzi.sportboard.ulanziPlugin";
// Generated outputs never enter the archive (design: collect excludes package output).
const EXCLUDED_DIRS = ["package", "dist.staging"];
const ZIP32_MAX = 0xffffffff;
// Fixed archive metadata: ZIP 2.0, store method, no flags, 1980-01-01 00:00:00,
// regular-file 0644 permissions. Nothing here depends on the build environment.
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 20;
const FLAGS = 0;
const METHOD_STORE = 0;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isSafeName(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name.includes("\\") || name.includes(":") || name.startsWith("/")) return false;
  return name.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function collectEntries({ pluginDir, fs }) {
  const entries = [];
  const walk = (relative) => {
    const directory = relative ? `${pluginDir}/${relative}` : pluginDir;
    const listed = fs.listDir(directory);
    if (listed === null) throw new Error(`package: not a directory: ${directory}`);
    for (const name of [...listed].sort()) {
      const path = relative ? `${relative}/${name}` : name;
      if (!isSafeName(path)) throw new Error(`package: unsafe entry name: ${path}`);
      if (fs.listDir(`${pluginDir}/${path}`) !== null) {
        if (!EXCLUDED_DIRS.includes(path)) walk(path);
        continue;
      }
      const data = fs.readFile(`${pluginDir}/${path}`);
      if (data === null) throw new Error(`package: unreadable entry: ${path}`);
      entries.push({ name: `${PLUGIN_FOLDER}/${path}`, data });
    }
  };
  walk("");
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

export function createZip(entries) {
  for (const { name, data } of entries) {
    if (!isSafeName(name)) throw new Error(`package: unsafe entry name: ${name}`);
    const size = data?.length;
    if (!Number.isSafeInteger(size) || size < 0 || size > ZIP32_MAX) {
      throw new Error(`package: ZIP64-sized entry rejected: ${name}`);
    }
  }
  const total = entries.reduce((sum, { data }) => sum + data.length, 0);
  if (total > ZIP32_MAX || entries.length > 0xffff) {
    throw new Error("package: ZIP64-sized archive rejected (total size or entry count)");
  }
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(VERSION_NEEDED),
      u16(FLAGS),
      u16(METHOD_STORE),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    local.push(localHeader, data);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(VERSION_MADE_BY),
        u16(VERSION_NEEDED),
        u16(FLAGS),
        u16(METHOD_STORE),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(EXTERNAL_ATTRS),
        u32(offset),
        nameBytes,
      ]),
    );
    offset += localHeader.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(directory.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...local, directory, end]);
}

// Parses the produced archive's central directory and asserts the entry names
// match the collected, sorted set exactly (rooted layout verification).
export function verifyZipLayout(zip, expectedNames) {
  const eocd = zip.length - 22;
  if (zip.readUInt32LE(eocd) !== 0x06054b50) {
    throw new Error("package: missing end-of-central-directory record");
  }
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const names = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("package: malformed central-directory record");
    }
    const nameLength = zip.readUInt16LE(offset + 28);
    names.push(zip.toString("utf8", offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32) + zip.readUInt16LE(offset + 34);
  }
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error("package: central-directory entry names do not match the collected entries");
  }
  return names;
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
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
  };
}

export function main() {
  try {
    const repoRoot = fileURLToPath(new URL("../", import.meta.url));
    const entries = collectEntries({ pluginDir: join(repoRoot, PLUGIN_FOLDER), fs: nodeFs() });
    if (!entries.some((entry) => entry.name === `${PLUGIN_FOLDER}/manifest.json`)) {
      throw new Error(`${PLUGIN_FOLDER}/manifest.json is missing from the package folder root`);
    }
    if (!entries.some((entry) => entry.name === `${PLUGIN_FOLDER}/assets/sounds/score-change.wav`)) {
      throw new Error(`${PLUGIN_FOLDER}/assets/sounds/score-change.wav is missing from the package`);
    }
    const zip = createZip(entries);
    verifyZipLayout(zip, entries.map((entry) => entry.name));
    const target = join(repoRoot, "package", `${PLUGIN_FOLDER}.zip`);
    const temp = `${target}.staging`;
    mkdirSync(join(repoRoot, "package"), { recursive: true });
    try {
      writeFileSync(temp, zip);
      renameSync(temp, target);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
    console.log(`package: wrote ${entries.length} entries to package/${PLUGIN_FOLDER}.zip`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
