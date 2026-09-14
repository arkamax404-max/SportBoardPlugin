"use strict";

// src/plugin/action-runtime.js — the single declared action's in-memory state
// machine (DA2). It owns Map<context, { stateIndex }>: add selects state 0,
// run advances modulo stateCount, clear deletes contexts, dispose clears the
// map. State is process-local — no timers, polling, settings, files,
// environment variables or clocks exist here and nothing is persisted; a
// restart or reconnect begins at state 0.

class ActionRuntime {
  #host;
  #actionUuid;
  #stateCount;
  #contexts = new Map();

  constructor({ host, actionUuid, stateCount = 2 }) {
    this.#host = host;
    this.#actionUuid = actionUuid;
    this.#stateCount = stateCount;
  }

  // Insert or reset the context to state 0 (a duplicate add resets to 0).
  add(event) {
    if (event?.actionid !== this.#actionUuid) return; // undeclared: no mutation, no command
    this.setState(event, 0);
  }

  // Advance modulo stateCount. A run for an absent context creates state 0
  // first, tolerating a simulator session that omitted add.
  run(event) {
    if (event?.actionid !== this.#actionUuid) return;
    if (!this.#contexts.has(event.context)) this.#contexts.set(event.context, { stateIndex: 0 });
    const { stateIndex } = this.#contexts.get(event.context);
    this.setState(event, (stateIndex + 1) % this.#stateCount);
  }

  // Delete each per-item context carried by a clear request's param[].
  clear(message) {
    const items = message && Array.isArray(message.param) ? message.param : [];
    for (const item of items) {
      if (item && typeof item === "object") this.#contexts.delete(item.context);
    }
  }

  // Send a declared static state (D3: the only rendering path). The declared-
  // action guard and the stateCount bounds are enforced before any host call,
  // so a defect fails as a deterministic local RangeError, never as an
  // outbound payload naming an undeclared state.
  setState({ actionid, context } = {}, stateIndex) {
    if (actionid !== this.#actionUuid) return;
    if (!Number.isInteger(stateIndex) || stateIndex < 0 || stateIndex >= this.#stateCount) {
      throw new RangeError(`state index ${String(stateIndex)} is outside the declared range 0..${this.#stateCount - 1}`);
    }
    this.#contexts.set(context, { stateIndex });
    this.#host.setState(context, stateIndex);
  }

  // Process/socket disposal: clear the map; no outbound network traffic.
  dispose() {
    this.#contexts.clear();
  }
}

module.exports = { ActionRuntime };
