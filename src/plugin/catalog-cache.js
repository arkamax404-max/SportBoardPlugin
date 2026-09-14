"use strict";

// src/plugin/catalog-cache.js — disk-backed cache for the selector option lists.
//
// The lists change rarely (one competition list, one team list per competition), so
// they are cached and reused across plugin restarts instead of spending provider
// requests. The cache is rewritten only when the user asks for a refresh, never on
// a timer.
//
// Secrets: the API token is never written. The cache is keyed by a hash of the
// token, which separates two accounts without persisting the secret itself.
// Robustness: a missing, unreadable or corrupt cache reads as an empty cache, and a
// failed write is swallowed, because the selectors must still work from live data.

const crypto = require("node:crypto");

const SCHEMA = "sportboard.catalog/v1";

function defaultHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

class CatalogCache {
  #fs;
  #filePath;
  #hash;

  constructor({ fs, filePath, hash = defaultHash } = {}) {
    if (!fs || typeof fs.readFile !== "function" || typeof fs.writeFile !== "function") {
      throw new TypeError("cache requires a filesystem adapter with readFile and writeFile");
    }
    if (typeof filePath !== "string" || filePath.length === 0) throw new TypeError("cache requires a file path");
    if (typeof hash !== "function") throw new TypeError("cache requires a hash function");
    this.#fs = fs;
    this.#filePath = filePath;
    this.#hash = hash;
  }

  loadCompetitions(token) {
    const entry = this.#entryFor(token);
    return Array.isArray(entry?.competitions) ? entry.competitions : null;
  }

  loadTeams(token, competition) {
    const teams = this.#entryFor(token)?.teams?.[String(competition)];
    return Array.isArray(teams) ? teams : null;
  }

  saveCompetitions(token, competitions) {
    const store = this.#read() ?? { schema: SCHEMA, tokens: {} };
    const entry = this.#entryIn(store, token);
    entry.competitions = competitions;
    this.#write(store);
  }

  saveTeams(token, competition, teams) {
    const store = this.#read() ?? { schema: SCHEMA, tokens: {} };
    const entry = this.#entryIn(store, token);
    if (!entry.teams || typeof entry.teams !== "object") entry.teams = {};
    entry.teams[String(competition)] = teams;
    this.#write(store);
  }

  #entryFor(token) {
    return this.#read()?.tokens?.[this.#hash(String(token))];
  }

  #entryIn(store, token) {
    const key = this.#hash(String(token));
    if (!store.tokens || typeof store.tokens !== "object") store.tokens = {};
    if (!store.tokens[key] || typeof store.tokens[key] !== "object") store.tokens[key] = {};
    return store.tokens[key];
  }

  #read() {
    try {
      const text = this.#fs.readFile(this.#filePath);
      if (typeof text !== "string") return null;
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || parsed.schema !== SCHEMA) return null;
      if (!parsed.tokens || typeof parsed.tokens !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  // Written through a temporary file and renamed, so a crash mid-write can never
  // leave a half-written cache behind.
  #write(store) {
    const temporary = `${this.#filePath}.tmp`;
    try {
      this.#fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`);
      this.#fs.rename(temporary, this.#filePath);
    } catch {
      try { this.#fs.remove?.(temporary); } catch { /* the cache is optional */ }
    }
  }
}

module.exports = { CatalogCache, SCHEMA };
