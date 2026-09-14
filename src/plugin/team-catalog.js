"use strict";

// src/plugin/team-catalog.js — keeps the Property Inspector selectors fed.
//
// Why the main service fetches instead of the inspector page: the inspector runs in
// the host's browser context, and the provider only allows the `http://localhost`
// origin, so a cross-origin call from the page is not dependable. The service
// already owns the token and the HTTP client, so it fetches the option lists and
// pushes them back through the standard sendToPropertyInspector channel.
//
// Caching: the lists come from the persistent disk cache first, so a plugin restart
// costs no requests. A list is fetched only when it is not cached, or when the user
// explicitly asks for a refresh. Nothing here runs on a timer.
//
// Failures are reported as a bounded payload, never as an exception: a selector that
// cannot load must not break the key.

class TeamCatalog {
  #service;
  #host;
  #cache;
  #competitionsByToken = new Map();
  #teamsByScope = new Map();
  #competitionLoads = new Map();
  #teamLoads = new Map();

  constructor({ service, host, cache } = {}) {
    if (!service || typeof service.listCompetitions !== "function" || typeof service.listTeams !== "function") {
      throw new TypeError("service must implement listCompetitions and listTeams");
    }
    if (!host || typeof host.sendToPropertyInspector !== "function") {
      throw new TypeError("host must implement sendToPropertyInspector");
    }
    if (cache && (typeof cache.loadCompetitions !== "function" || typeof cache.saveCompetitions !== "function")) {
      throw new TypeError("cache must implement the catalog cache interface");
    }
    this.#service = service;
    this.#host = host;
    this.#cache = cache ?? null;
  }

  // Publish both option lists for one action context. `param.refresh` is the user's
  // explicit request to ignore both caches and reload from the provider.
  async publish({ context, param } = {}) {
    const token = typeof param?.token === "string" ? param.token.trim() : "";
    const competition = typeof param?.competition === "string" ? param.competition.trim() : "";
    const refresh = param?.refresh === true;
    const resend = param?.sync === true;
    if (token.length === 0) {
      this.#host.sendToPropertyInspector(context, { teams: [], error: "token required" });
      return;
    }

    const competitions = await this.#competitions(token, refresh, resend);
    if (competitions !== undefined) {
      this.#host.sendToPropertyInspector(
        context,
        competitions === null ? { competitions: [], error: "competitions unavailable" } : { competitions },
      );
    }

    if (competition.length === 0) return;
    const teams = await this.#teams(token, competition, refresh, resend);
    if (teams !== undefined) {
      this.#host.sendToPropertyInspector(
        context,
        teams === null
          ? { teams: [], competition, error: "teams unavailable" }
          : { teams, competition },
      );
    }
  }

  // Returns undefined when the list is already published and unchanged, null when
  // the provider failed, and the list otherwise.
  async #competitions(token, refresh, resend) {
    const normalKey = `normal|${token}`;
    const refreshKey = `refresh|${token}`;
    // A sync that races a manual refresh must wait for the fresh list instead of
    // immediately replaying stale in-memory data.
    if (!refresh && this.#competitionLoads.has(refreshKey)) return this.#competitionLoads.get(refreshKey);
    if (!refresh && this.#competitionsByToken.has(token)) {
      return resend ? this.#competitionsByToken.get(token) : undefined;
    }
    if (!refresh && this.#competitionLoads.has(normalKey)) return this.#competitionLoads.get(normalKey);
    if (refresh && this.#competitionLoads.has(refreshKey)) return this.#competitionLoads.get(refreshKey);
    if (refresh && this.#competitionLoads.has(normalKey)) await this.#competitionLoads.get(normalKey);
    if (refresh && this.#competitionLoads.has(refreshKey)) return this.#competitionLoads.get(refreshKey);
    const loadKey = refresh ? refreshKey : normalKey;
    const load = (async () => {
      let competitions = refresh ? null : this.#cache?.loadCompetitions(token) ?? null;
      if (competitions === null) {
        try {
          competitions = await this.#service.listCompetitions(token);
        } catch {
          return null;
        }
        this.#cache?.saveCompetitions(token, competitions);
      }
      this.#competitionsByToken.set(token, competitions);
      return competitions;
    })();
    this.#competitionLoads.set(loadKey, load);
    try {
      return await load;
    } finally {
      if (this.#competitionLoads.get(loadKey) === load) this.#competitionLoads.delete(loadKey);
    }
  }

  async #teams(token, competition, refresh, resend) {
    const scope = `${token}|${competition}`;
    const normalKey = `normal|${scope}`;
    const refreshKey = `refresh|${scope}`;
    if (!refresh && this.#teamLoads.has(refreshKey)) return this.#teamLoads.get(refreshKey);
    if (!refresh && this.#teamsByScope.has(scope)) {
      return resend ? this.#teamsByScope.get(scope) : undefined;
    }
    if (!refresh && this.#teamLoads.has(normalKey)) return this.#teamLoads.get(normalKey);
    if (refresh && this.#teamLoads.has(refreshKey)) return this.#teamLoads.get(refreshKey);
    if (refresh && this.#teamLoads.has(normalKey)) await this.#teamLoads.get(normalKey);
    if (refresh && this.#teamLoads.has(refreshKey)) return this.#teamLoads.get(refreshKey);
    const loadKey = refresh ? refreshKey : normalKey;
    const load = (async () => {
      let teams = refresh ? null : this.#cache?.loadTeams(token, competition) ?? null;
      if (teams === null) {
        try {
          teams = await this.#service.listTeams(token, competition);
        } catch {
          return null;
        }
        this.#cache?.saveTeams(token, competition, teams);
      }
      this.#teamsByScope.set(scope, teams);
      return teams;
    })();
    this.#teamLoads.set(loadKey, load);
    try {
      return await load;
    } finally {
      if (this.#teamLoads.get(loadKey) === load) this.#teamLoads.delete(loadKey);
    }
  }
}

module.exports = { TeamCatalog };
