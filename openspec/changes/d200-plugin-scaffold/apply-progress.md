# Apply Progress — d200-plugin-scaffold

Cumulative record. Slice 1 (PR 1) implemented in one session (post-reload, fresh-native-attempt retry,
attempt token sha256:0d92efa9d9d4a85b4b120a7c4eb429fcf8791b61bb28e8796d5046a8e3843a3e, work unit
`d200-scaffold-slice-1`). No later slice was started. Nothing committed, no branches, no PRs.

## Completed tasks (persisted checkbox updates)

- [x] 1.1 — RED: `test/toolchain.test.js` created first; 10 `node:test` cases against the validators
  exported by `scripts/check.mjs`. RED evidence: `node --test test/*.test.js` → **10 tests, 0 pass,
  10 fail, all `ERR_MODULE_NOT_FOUND: scripts/check.mjs`** (expected reason: module absent).
- [x] 1.2 — `com.ulanzi.sportboard.ulanziPlugin/manifest.json` created: exactly `Author`, `Name`,
  `Icon`, `Version`, `CodePath` = `dist/main.js`, `Type` = `JavaScript`, `UUID`
  `com.ulanzi.ulanzistudio.sportboard`, one action `com.ulanzi.ulanzistudio.sportboard.status` with
  `States` [Ready, Selected], `DisableAutomaticStates: true`, `Controllers: ["Keypad"]`,
  `Devices: ["D200"]`. No `Banner`, `Detail`, `MinimumVersion`, `PropertyInspectorPath`,
  `Software.MinVersion`.
- [x] 1.3 — Four static PNGs committed as source artifacts (72×72 RGBA, 171 bytes each):
  `assets/{plugin,action,ready,selected}.png`. Verified: exact casing matches manifest references,
  8-byte PNG signature `89 50 4e 47 0d 0a 1a 0a` in every file, zero `.svg`/`data:` assets in the
  package folder. Generated once by a throwaway inline script that is **not** part of the repository
  (DA5: no generation path exists in the repo).
- [x] 1.4 — `scripts/check.mjs` implemented (GREEN): exports pure validators
  (`parseJsonFile`, `validatePackageJson`, `validateManifest`, `validateAssets`,
  `validatePackageStructure`, `collectDefects`, `sortDefects`, `main`) taking in-memory data plus an
  injected read-only fs adapter (`listDir`, `readBytes`); executable entry reports every defect sorted
  by (path, rule, message) and exits 1. Covers design check items 1–3 plus the structural
  no-`property-inspector` rule. All paths resolved from `import.meta.url`.
- [x] 1.5 — `package.json` created (`private: true`, `version` `0.1.0`, `engines.node` `">=20"`, no
  `dependencies`/`devDependencies`, `check` = `node scripts/check.mjs`, `test` =
  `node --test test/*.test.js`) and `.gitignore` extended with `dist/`, `package/`, `node_modules/`.
  `npm pkg get engines scripts dependencies devDependencies` shows exactly the intended shape
  (dependencies/devDependencies absent).
- [x] 1.6 — Slice gate green: `npm run check` → "check passed: com.ulanzi.sportboard.ulanziPlugin
  metadata, manifest and assets are valid."; `npm test` → **10/10 pass**. Read-only and token sweeps
  below.

## Files changed (slice 1 / PR 1 boundary)

| File | Change | Lines |
|---|---|---|
| `test/toolchain.test.js` | new | 254 |
| `scripts/check.mjs` | new | 349 |
| `com.ulanzi.sportboard.ulanziPlugin/manifest.json` | new | 23 |
| `package.json` | new | 13 |
| `.gitignore` | extended | +5 |
| `com.ulanzi.sportboard.ulanziPlugin/assets/{plugin,action,ready,selected}.png` | new (binary) | ~0 diffstat |
| **Total changed lines** | | **≈644** |

## Test commands run and outputs

1. `node --test test/*.test.js` (RED, before check.mjs existed): `tests 10 · pass 0 · fail 10`,
   every failure `ERR_MODULE_NOT_FOUND: .../scripts/check.mjs`.
2. `node --test test/*.test.js` (GREEN): `tests 10 · pass 10 · fail 0`.
3. `npm test`: 10/10 pass.
4. `npm run check`: `check passed: com.ulanzi.sportboard.ulanziPlugin metadata, manifest and assets
   are valid.` (exit 0).
5. Negative CLI smoke on a scratch copy (`/tmp`, deleted afterwards): manifest mutated with
   missing `Author`, added `Banner`, `Devices: ["D205"]`, mis-cased `assets/Ready.png`, plus
   `package.json` version drift → check reported **all 5 defects in stable path/rule order** and
   exited **1**.
6. `npm pkg get engines scripts dependencies devDependencies`: `engines.node >=20`; `check`/`test`
   scripts exact; dependency keys absent.

## TDD cycle evidence (RED → GREEN; strict_tdd is false in config, RED→GREEN requested by user)

| Cycle | Task | RED | GREEN |
|---|---|---|---|
| 1 | 1.1→1.4 | 10/10 failing, `ERR_MODULE_NOT_FOUND` (module absent) | 10/10 pass after `scripts/check.mjs` + manifest + assets + package.json |

## Gate sweeps (task 1.6)

- `scripts/check.mjs` is read-only: no write/append/mkdir/rename/unlink/chmod/stream APIs (grep clean).
- Forbidden-token sweep over slice-1 files (`fetch`, `http(s)://`, `listen(`, `dgram`, `tls`, `dns`,
  `data:image`, `.svg`, `setImage`, `setTitle`, `base64`): only hits are the *negative-test guards*
  in `test/toolchain.test.js` that assert such tokens are rejected (D3). The shipped manifest contains
  none. `src/plugin/` does not exist yet in this slice.
- Property Inspector: zero manifest references; `property-inspector` appears only as the forbidden-
  structure guard rule and its test (D4).
- G1: no production install/sideload claim in any slice-1 file.

## Deviations from design (all minor, recorded)

1. `CodePath` (`dist/main.js`) gets path-safety checks but **no existence check** in `check.mjs`:
   `dist/` is produced by the slice-4 build, and a check that requires it would fail on every clean
   checkout before slice 4. Existence is verified post-build by the slice-4 packaging flow.
2. `validatePackageJson` also validates `build`/`package` script commands **when present** (exact
   contract strings from task 4.5) without requiring them, so the slice-1 `check` script never
   declares a command whose file is absent and cannot silently drift in slice 4.
3. The top-level allowed-key set is the 8 required keys plus documented-optional `Software` (object;
   only `MinVersion` child allowed), so a documented optional key (spec: MAY be used) is not rejected.
4. Asset defect reporting short-circuits per reference (first failing rule wins: path-safety →
   png-extension → missing/case → png-signature) to keep defect lists stable and actionable.
5. CJS test files load the ESM check script via dynamic `import()` (Node caches the module), because
   the runtime must stay CommonJS (D1) and the test-script glob is design-fixed to `test/*.test.js`.

## Review workload / delivery boundary

- Landed measurement: **≈644 changed lines** — over the canonical 400-line budget and above the
  tasks' slice-1 estimate band (300–430). No later slice was started (no widening).
- Why it cannot shrink without harming the review: the 349-line checker implements one validator rule
  per contract behavior demanded by task 1.1 and design check items 1–3 (required/unknown/forbidden
  keys, UUID shape, UUID extension, version drift, one action, D200/Keypad, two ordered states,
  asset path-safety/casing/existence/PNG-signature, no-PI structure, engines/scripts/deps); the
  254-line test file pins each rule. The pure-validator + injected-fs architecture is design-mandated
  (tests must not touch the real tree). Deleting comments/tests/formatting to reach 400 is forbidden
  by the budget contract.
- Delivery decision now needed from the user (do not infer): **`size:exception`** acceptance for
  PR 1 as implemented, **or** a maintainer-approved re-slice of tasks 1.x (planning-artifact change).
  Note: a 1a/1b file split (metadata+assets vs checker+tests) leaves the checker+tests half at
  ≈600 lines, still over budget, so the exception is the realistic path.
- PR 1 boundary = the files listed above. Nothing committed; branch/PR creation is user-owned.

## Remaining tasks

- Slice 2 (PR 2): tasks 2.1–2.9 (host transport). Slice 3 (PR 3): 3.1–3.8. Slice 4 (PR 4): 4.1–4.7.
  Slice 5 (PR 5): 5.1–5.5. All unchecked in `tasks.md`.
- Persisted task artifact re-read after updates: tasks 1.1–1.6 show `- [x]`; slice 2–5 tasks remain
  `- [ ]` (verified by grep during this session).

## Structured status consumed

- `applyState: ready`, `artifactStore: openspec`, `actionContext.mode: repo-local`,
  `allowedEditRoots: ["/mnt/d/Desarrollo/SportBoardPlugin"]` — all edits inside the allowed root.
- `sdd-attempt acquire` (continuing existing token sha256:0d92efa9…) → state `proceed`.
- Config: `strict_tdd: false`; RED→GREEN followed per explicit user instruction.
- Config: `strict_tdd: false`; RED→GREEN followed per explicit user instruction.
- Attempt settlement: `settle --outcome passed --evidence-revision sha256:21dd3012…` (deterministic
  hash over path + per-file sha256 of all slice-1 files plus the updated tasks/apply-progress
  artifacts — recomputable by verify). The provider recorded the pass with that evidence revision but
  returned state **blocked / `maintainer_decision`**: the attempt accounting (its changed-line budget
  of 400; the harness counted the selected untracked inventory at 2,512 lines including pre-existing
  openspec/.pi files) requires a **maintainer reset** before the objective is complete.
  `status` → `decision_required: true`, `next_action: "reset"`, current runtime revision
  `sha256:49b0feb9ff166484ff2ae961297194d5177ad133430d7316ca871c1ea44b5ba0`.
  Per the runtime authority, reset is never automatic — it is returned to the maintainer together
  with the identical `size:exception`-vs-re-slice delivery decision above.
