# Tasks — d200-plugin-scaffold

Change 1 of 2. Consumes `proposal.md`, `specs/plugin-package/spec.md`,
`specs/plugin-runtime/spec.md`, `specs/plugin-toolchain/spec.md`, and `design.md`.

No source code is written by this phase. Every task below lands in one focused session and pairs
its change with the test/check evidence that proves it. Slice grouping = one PR per slice.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,000–1,450 (`src/plugin/*.js` ~600–800, `test/*.test.js` ~450–600, docs+config ~130–170, `scripts/*.mjs` counted inside source group; 4 committed PNGs are binary and contribute ~0 diffstat lines but non-trivial review bytes) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 skeleton + manifest gate → PR 2 host transport → PR 3 action lifecycle/composition → PR 4 build + package + README recipe |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Estimate rationale and its variance versus the proposal's ``~700–1050``:

- The design fixes exact frame-codec edge cases (partial/coalesced frames, mask injection, length
  boundaries 125/126, 1 MiB cap, ping/pong/close, fragmented/binary rejection) and exact-payload
  assertions, which is the single largest test block (`test/host-client.test.js`).
- The design also requires deterministic build/ZIP tests (stale-output removal, CRC values, fixed
  metadata, repeat byte-equality) in `test/toolchain.test.js`, plus a multi-rule `scripts/check.mjs`.
- `scripts/package.mjs` (ZIP32 store writer) and `src/plugin/host-client.js` (HTTP upgrade +
  RFC 6455 subset over `node:net`) are parity-sized with the inspected sibling implementations
  (107 and 142 lines respectively) and are expected to grow with the design's hardening rules.
- Every slice estimate below is an estimate; if a slice measures over 400 changed lines at apply
  time, it MUST be split before its PR is opened. PR 2 carries the highest variance.

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

## Delivery decision (pending — not inferred)

Risk is High (est. 2.5–3.6× the canonical 400-line budget). Under `ask-on-risk` the orchestrator
MUST pause before apply and ask the user how to deliver. This phase does **not** select a chain
strategy (`pending`) and does **not** infer `size:exception`; `exception-ok` requires explicit user
acceptance of `size:exception` and cannot be granted by an agent.

## Constraints carried into every task

| ID | Constraint | Task consequence |
|---|---|---|
| D1 | CommonJS, zero runtime dependencies, modeled on FlightInfoPlugin | `require`/`module.exports` only; no `dependencies`/`devDependencies`; no bundler; only `node:events`, `node:crypto`, `node:net` |
| D2 | Automated checks + documented simulator recipe; no hardware gate | `check`/`test`/`build`/`package` are the gates; simulator output is evidence, never a pass/fail gate |
| D3 | One D200 action, static icon/state only, no network, no dynamic SVG | Committed PNGs only; state indexes only; no `fetch`/HTTP/DNS/TLS/dgram, no generated image, no `data:` URI, no base64 art, no provider module |
| D4 | No Property Inspector | No `property-inspector/`, no `PropertyInspectorPath`, no `RandomPort`, no listening socket, no inspector channel |
| G1 | Production install path undocumented | No artifact may state a production install/sideload path |
| G2 | No official caching policy known | No cache/TTL/polling path exists in this change; stays carried for change 2 |
| G3 | UlanziStudio version unknown | No V3.1-only command (`setImage`, `setTitle`) may be used or referenced as available |

Pinned identity (design DA1): package folder `com.ulanzi.sportboard.ulanziPlugin`, plugin UUID
`com.ulanzi.ulanzistudio.sportboard`, action UUID `com.ulanzi.ulanzistudio.sportboard.status`,
display name `Sport Board`, author `SportBoardPlugin Contributors`, version `0.1.0`. States:
`Ready` = index 0, `Selected` = index 1 (DA2).

Test-file layout is fixed by the design: `test/host-client.test.js`, `test/action-runtime.test.js`,
`test/toolchain.test.js`. Composition tests for `main.js` `start(...)` live in
`test/action-runtime.test.js` to keep that layout.

---

## Slice 1 (PR 1) — Package skeleton, identity and manifest gate

Estimated 300–430 changed lines. Repo-level end state: `npm run check` and `npm test` runnable and
green. Note: this PR lands `package.json` with only the `check` and `test` scripts; the `build` and
`package` scripts are added by slice 4 (task 4.5) so no PR ever declares a command whose file is
absent.

- [x] **1.1** Create `test/toolchain.test.js` with failing (`RED`) `node:test` + `node:assert/strict` cases against the validators exported by `scripts/check.mjs`: `package.json` parses; missing/unknown manifest field; plugin UUID not 4 segments; action UUID not extending the plugin UUID; `package.json`/`manifest.json` version drift; missing or mis-cased asset; exactly one action; D200/keypad targeting; two valid states; forbidden keys `Banner`, `Detail`, `MinimumVersion`, `PropertyInspectorPath`. Evidence: `node --test test/*.test.js` fails for the expected reason (module absent). <!-- sdd-owner: implementation -->
- [x] **1.2** Create `com.ulanzi.sportboard.ulanziPlugin/manifest.json` with exactly `Author`, `Name`, `Icon`, `Version`, `CodePath` = `dist/main.js`, `Type` = `JavaScript`, `UUID`, `Actions`; one action with `Name`, `Icon`, `UUID`, `States` (`Ready`, `Selected`), `DisableAutomaticStates: true`, `Controllers: ["Keypad"]`, `Devices: ["D200"]`; no `Banner`, `Detail`, `MinimumVersion`, `PropertyInspectorPath`, `Software.MinVersion`. <!-- sdd-owner: implementation -->
- [x] **1.3** Commit the four static PNG sources `com.ulanzi.sportboard.ulanziPlugin/assets/{plugin,action,ready,selected}.png` referenced by the manifest (DA5: source artifacts, never generated). Verify each file exists with exact casing and a PNG signature, and that no `.svg`/`data:image` asset path is introduced. <!-- sdd-owner: implementation -->
- [x] **1.4** Implement `scripts/check.mjs` so the validators exercised in 1.1 pass (`GREEN`): export pure validators, and when executed report all defects in stable path/rule order then exit non-zero. Cover design check items 1–3 plus the structural assertion that no `property-inspector` directory exists. All paths resolved from `import.meta.url`. <!-- sdd-owner: implementation -->
- [x] **1.5** Create `package.json` (`private: true`, `version` `0.1.0`, `engines.node` `>=20`, no `dependencies`/`devDependencies`, scripts `check` = `node scripts/check.mjs`, `test` = `node --test test/*.test.js`) and extend `.gitignore` with `dist/`, `package/`, `node_modules/`. Verify `npm pkg get engines scripts dependencies devDependencies` shows the intended shape. <!-- sdd-owner: implementation -->
- [x] **1.6** Slice gate: run `npm run check` and `npm test` green from the working tree; confirm `scripts/check.mjs` is read-only and that the slice leaves no claim about a production install path (G1) and no PI/network/dynamic-rendering token. <!-- sdd-owner: implementation -->

## Slice 2 (PR 2) — Host transport: launch args, upgrade, and frame codec

Estimated 450–620 changed lines, the highest-variance slice. If it measures over 400 lines at apply
time, split it into PR 2a (launch args + upgrade handshake, tasks 2.1–2.4) and PR 2b (frame codec +
`HostClient`, tasks 2.5–2.8).

- [ ] **2.1** `RED` in `test/host-client.test.js` for the configuration seams of `src/plugin/host-client.js`: `parseLaunchArgs` with a valid triple; missing address, missing language, missing port; non-numeric, zero, negative and out-of-range port; and an assertion that the injected connector receives exactly the validated `{address, port}`. <!-- sdd-owner: implementation -->
- [ ] **2.2** Implement `parseLaunchArgs(argv)` and the launch-argument failure path so 2.1 passes, failing before any socket is opened and never applying a default endpoint (A1). <!-- sdd-owner: implementation -->
- [ ] **2.3** `RED` in `test/host-client.test.js` for the handshake and context seams: exact `createUpgradeRequest({address, port, key})` bytes with an injected key; `parseUpgradeResponse` accepting a valid HTTP 101 with matching `Sec-WebSocket-Accept`; rejection of wrong status, missing/incompatible upgrade headers, wrong accept value; accumulation across split chunks; the 16 KiB header cap; and preservation of post-header bytes as frame remainder. <!-- sdd-owner: implementation -->
- [ ] **2.4** Implement `createUpgradeRequest` and `parseUpgradeResponse` (`GREEN`) in `src/plugin/host-client.js` using only `node:crypto` and `node:net` primitives; destroy the socket before any `connected` payload on an invalid upgrade. <!-- sdd-owner: implementation -->
- [ ] **2.5** `RED` in `test/host-client.test.js` for the frame codec: masked `encodeClientFrame` output with an injected mask; payload lengths around the 125/126 boundary; `decodeServerFrames` for partial frames retained across chunks and coalesced frames processed in order; ping → masked pong on the same socket; close ends dispatch; malformed, fragmented data, binary and payloads above 1 MiB rejected as protocol errors without partial dispatch (DA3/DA4). <!-- sdd-owner: implementation -->
- [ ] **2.6** Implement `encodeClientFrame` and `decodeServerFrames` (`GREEN`), including the 1 MiB cap applied before allocation and a bounded output path that never queues unbounded writes. <!-- sdd-owner: implementation -->
- [ ] **2.7** `RED` in `test/host-client.test.js` for `HostClient` ownership with a fake socket (no real socket opened): one connect only; exact `{"cmd":"connected","uuid":"com.ulanzi.ulanzistudio.sportboard","code":0}` after a valid upgrade; same-socket acknowledgement; acknowledgement precedes local event dispatch; malformed JSON causes no state mutation and no response loop; socket error/close emitted once with no reconnect or endpoint fallback; `sendObject` returns `false` before upgrade completion and when the socket is not writable. <!-- sdd-owner: implementation -->
- [ ] **2.8** Implement `HostClient` as an `EventEmitter`-compatible transport owner (`GREEN`) that is the sole importer of `node:net` in the runtime; assert no other `src/plugin/*.js` file imports a networking built-in (design check item 5). <!-- sdd-owner: implementation -->
- [ ] **2.9** Slice gate: `npm run check` and `npm test` green; confirm `test/host-client.test.js` opens no real socket and reaches no network, and that no image/title/path rendering method exists on the client. <!-- sdd-owner: implementation -->

## Slice 3 (PR 3) — Action lifecycle and process composition

Estimated 300–420 changed lines.

- [ ] **3.1** `RED` in `test/action-runtime.test.js`: exact deep-equality of the `type: 0` state command `{cmd:"state", uuid, param:{statelist:[{uuid, key, actionid, type:0, state, textData:"", showtext:false}]}}`; `createStateCommand` rejects negative, non-integer and out-of-range indexes; `createAck` returns the request envelope with `code: 0` under the same `cmd`; `encodeContext`/`decodeContext` round-trip and rejection of missing or extra `___` components. <!-- sdd-owner: implementation -->
- [ ] **3.2** Implement `createAck`, `createStateCommand`, `encodeContext` and `decodeContext` (`GREEN`) in `src/plugin/host-client.js`; expose no path, base64, title or image method. <!-- sdd-owner: implementation -->
- [ ] **3.3** `RED` in `test/action-runtime.test.js` for `ActionRuntime`: `add` → state 0; repeated `run` cycling `1 → 0`; `run` before `add` tolerated by creating state 0 first; duplicate `add` resets to 0; `clear` deleting each `param[]` context; undeclared action producing no mutation and no state command; disposal clearing the map; `stateCount: 2` bounds enforced (DA2). <!-- sdd-owner: implementation -->
- [ ] **3.4** Implement `src/plugin/action-runtime.js` (`GREEN`) with `Map<context, { stateIndex }>`, the declared-action guard, and no timers, polling, settings, files, environment variables or clocks. <!-- sdd-owner: implementation -->
- [ ] **3.5** `RED` in `test/action-runtime.test.js` for the composition seam `start({ argv, connect, randomBytes, stderr })` from `src/plugin/main.js`: non-zero exit status with one sanitized argument error and no connector call when launch args are invalid; handlers registered before connect; exactly one connect; `SIGINT`/`SIGTERM` disposal; no raw frame or payload text written to the injected stderr. <!-- sdd-owner: implementation -->
- [ ] **3.6** Implement `src/plugin/main.js` (`GREEN`): CommonJS, `require.main === module` guard, injected seams defaulting to Node built-ins, compile-time identity constants, short lifecycle/error categories only on stderr. <!-- sdd-owner: implementation -->
- [ ] **3.7** `TRIANGULATE`/process smoke: `node src/plugin/main.js` with no arguments exits non-zero with a sanitized error and opens no socket; a stubbed-run sequence (`connected` → `add` → `run` → `run` → `clear`) produces the exact ordered outbound payloads. <!-- sdd-owner: implementation -->
- [ ] **3.8** Slice gate: `npm run check` and `npm test` green; confirm no `setactive`, reconnect or persistence behaviour was added beyond the design contract. <!-- sdd-owner: implementation -->

## Slice 4 (PR 4) — Build, package and the simulator recipe

Estimated 350–480 changed lines.

- [ ] **4.1** `RED` in `test/toolchain.test.js` for `scripts/build.mjs`: a fixture tree proves stale `dist/` entries are removed, exactly the three `src/plugin/*.js` files are copied byte-for-byte, no extra file appears, and the temporary staging directory is removed on failure while a previously completed `dist/` is left untouched. <!-- sdd-owner: implementation -->
- [ ] **4.2** Implement `scripts/build.mjs` (`GREEN`): sorted local copy of `src/plugin/` into a temporary sibling of `com.ulanzi.sportboard.ulanziPlugin/dist/`, then atomic rename; no transform, bundle, fetch or asset generation; paths from `import.meta.url`. <!-- sdd-owner: implementation -->
- [ ] **4.3** `RED` in `test/toolchain.test.js` for the ZIP seams `crc32`, `collectEntries`, `createZip(entries)`: normalized sorted root names prefixed with `com.ulanzi.sportboard.ulanziPlugin/`; known CRC32 values; fixed DOS timestamp/date and flags; rejection of traversal and absolute names; ZIP64-size rejection; manifest present at the plugin-folder root; two runs over an identical tree producing byte-identical archives. <!-- sdd-owner: implementation -->
- [ ] **4.4** Implement `scripts/package.mjs` (`GREEN`): ZIP32 store writer with no compression, fixed metadata, no environment-specific absolute path or current timestamp, temp-write then rename, and no replacement of a prior ZIP on failure. <!-- sdd-owner: implementation -->
- [ ] **4.5** Add the `build` (`node scripts/build.mjs`) and `package` (`npm run check && npm test && npm run build && node scripts/package.mjs`) scripts to `package.json`, completing the `testing.setup_gate` command set, and confirm the version stays identical to `manifest.json`. <!-- sdd-owner: implementation -->
- [ ] **4.6** Write `README.md`: gate commands, the UlanziDeck Simulator recipe (port 39069, manual main-service start, manual event injection), the simulator's limits (partial, reference-only, does not actively send `setactive`, desktop behaviour is the source of truth, manual copies are disposable verification artifacts), no physical D200 run as a gate (D2/A6), no production install path claim (G1), and the static-state-only/no-network/no-PI scope (D3/D4/G3). Pair it with a `test/toolchain.test.js` assertion that the required recipe anchors and limit statements are present, so the README is never landed without a runnable check. <!-- sdd-owner: implementation -->
- [ ] **4.7** Slice gate: full chain `npm run check && npm test && npm run build && npm run package` green from a clean tree; manual ZIP inspection shows `com.ulanzi.sportboard.ulanziPlugin/manifest.json` at the root; `git status` shows no tracked `dist/`, `package/` or `node_modules/`. <!-- sdd-owner: implementation -->

## Slice 5 (PR 5) — Change-level verification and carried unknowns

Estimated 100–180 changed lines (verification-only unless a defect is found). May be folded into
slice 4's PR if it stays inside the budget and the review boundary stays legible.

- [ ] **5.1** Verify every artifact retains G1–G3 and A4/A6 as unresolved carried unknowns: no production install path anywhere, no cache/TTL/polling path, no V3.1-only command, `Banner`/`Detail` and `PropertyInspectorPath` absent, and simulator limits recorded as evidence rather than acceptance. <!-- sdd-owner: implementation -->
- [ ] **5.2** Scope-guard sweep: grep the runtime and package for `fetch`, `http`/`https`/`tls`/`dns`/`dgram`, `listen(`, `data:image`, `.svg`, `setImage`, `setTitle`, `property-inspector`, `base64` → zero in-scope hits; confirm `src/plugin/host-client.js` is the only `node:net` importer. <!-- sdd-owner: implementation -->
- [ ] **5.3** Determinism and secrets gate: run `check`/`test`/`build`/`package` twice on the same tree and confirm equivalent results including byte-identical ZIP; scan all files added by this change for credential-shaped values and confirm no secret, URL or key appears in source, defaults, docs, logs or assets. <!-- sdd-owner: implementation -->
- [ ] **5.4** Simulator observation (manual, non-gating): follow the README recipe, load the package, drag the single action onto a D200 key, observe the static icon and state transition, and record the observation plus any host rejection against A4/A5/A6 and the simulator's limits. <!-- sdd-owner: implementation -->
- [ ] **5.5** Rollback check: confirm each slice's added files are removable independently, and that removing all added files plus generated outputs restores the bootstrap state (`.gitignore`, `.pi/`, `openspec/`) with `strict_tdd` back to failing closed and no external cleanup required. <!-- sdd-owner: implementation -->

## Traceability

| Requirement | Tasks |
|---|---|
| Package folder layout; manifest field gate; identity consistency; one static D200 action; static assets only | 1.1–1.6, 4.7 |
| Launch arguments; built-in-only connection; action lifecycle; static-state-only rendering; no network beyond host; no PI surface | 2.1–2.9, 3.1–3.8, 5.2 |
| Deterministic offline gates; pure-seam and exact-payload tests; deterministic build/ZIP; README recipe and limits; no secrets; rollback-compatible boundaries | 1.5–1.6, 4.1–4.7, 5.1, 5.3, 5.5 |

Out of scope for every task in this file: TheSportsDB or any API access, polling/caching, generated
SVG or base64 rendering, Property Inspector work, multi-action/multi-sport behaviour, store
publication metadata, and any physical-D200 acceptance gate (D2–D4, G2, G3).
