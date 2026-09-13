# Proposal — d200-plugin-scaffold

Change 1 of 2. This change turns SportBoardPlugin from an empty repository into a loadable,
verifiable Ulanzi D200 plugin package that renders one static action. Change 2
(`football-live-score`) adds the live data view on top of this scaffold.

Proposal only. No specs, no design, no tasks, no code. See `explore.md`, `research.md` and
`preproposal.md` for the evidence this proposal rests on.

## Answer first

| Question | Answer |
|---|---|
| What are we building? | A CommonJS, zero-runtime-dependency UlanziStudio Node plugin package with exactly one action, static manifest icon/state rendering, and no network access. |
| Why now? | The repo is empty but `openspec/config.yaml` already declares the target commands (`check`/`test`/`build`/`package`); this scaffold is the moment those become real and `strict_tdd` can stop failing closed. |
| Who is affected? | The plugin author/reviewer of change 2, and the end user running the package in UlanziDeck Simulator or UlanziStudio. |
| How do we know it works? | `npm run check`, `node --test test/*.test.js`, `npm run build`, `npm run package`, plus a documented UlanziDeck Simulator run recipe. No physical D200 run is a gate. |
| What is the main risk? | The hand-rolled WebSocket/host client and manifest field assumptions are only exercised by unit tests and the simulator, so a host-specific defect can survive this change. |
| Does it fit one review? | No. A faithful scaffold is estimated at ~700–1050 changed lines; it needs 3 chained slices against the 400-line budget. The delivery decision stays with the orchestrator/user (`ask-on-risk`). |

## Intent

The product goal is a live sports score key for the Ulanzi D200. That goal needs a plugin
package before it can need data: manifest, host handshake, action lifecycle, build and packaging
scripts, and a test seam that runs without hardware or network.

Two problems make this change worth doing as its own slice:

1. **Nothing is verifiable yet.** `openspec/config.yaml` declares Node >= 20, `npm test`,
   `npm run check` and `npm run build`, and `testing.setup_gate` promotes `strict_tdd` to true
   once they exist. Until then every later change inherits "TDD fails closed" and no runnable check.
2. **The host contract is the unknown layer.** Everything change 2 depends on — how the plugin is
   started, how actions arrive, how a key is drawn — belongs to this scaffold. Getting it wrong
   later means debugging live-score logic and host plumbing at the same time.

Product outcome after this change: a reviewer can build the package, load it in the simulator,
drag the single action onto a key, and see the action's static icon and state rendered by the host
— with automated checks green and no network access anywhere in the runtime.

## Confirmed product decisions (input, not open questions)

These are user-confirmed and relayed by the orchestrator. This proposal records and applies them;
it does not re-open them.

| ID | Decision | Concrete consequence in this change |
|---|---|---|
| D1 | CommonJS, zero runtime dependencies, modeled on FlightInfoPlugin. | No npm runtime deps, no ESM source, no esbuild step. Host WebSocket-over-`node:net` and the ZIP writer are local code. |
| D2 | Automated checks plus a documented UlanziDeck Simulator recipe; no hardware acceptance gate. | Completion is `check`/`test`/`build`/`package` plus a written simulator recipe. No physical D200 run blocks the change. |
| D3 | One D200 action, static icon/state only; no dynamic SVG, no network. | Manifest `States` + static assets only. No generated SVG, no base64 image payloads, no outbound requests at runtime. |
| D4 | No Property Inspector. | No `property-inspector/` directory, no `PropertyInspectorPath` entry, no inspector↔service channel, no `RandomPort`. |

### Evidence context for these decisions (unchanged by this change)

- D1 diverges from the documented vendor SDK path: `ulanzideck-api` 0.1.0 is an ES module depending
  on `ws ^8.18.0` (C15/S4) and is unpublished on npm (C16/S7). The confirmed choice therefore
  implements the host protocol locally rather than consuming that SDK as published.
- D3 leaves validated TheSportsDB evidence (C22–C40: base URL, response shapes, 30 rpm free-tier
  limit, credential exposure) **unused in this slice**. It stays carried for change 2.
- D4 removes the `property-inspector/` package element (C1) and `RandomPort` (C13) from scope
  without invalidating either as documented behaviour.

## Scope

### In scope

1. **Package skeleton** — `package.json` (`engines.node >= 20`, `check`/`test`/`build`/`package`
   scripts), `.gitignore` extended for `dist/`, `package/`, `node_modules/`, the
   `com.ulanzi.<segment>.ulanziPlugin/` package folder with `manifest.json`, and static icon assets.
2. **Manifest correctness** — documented required fields only, D200 device targeting, one action,
   declared static states (C2, C3, C4, C5).
3. **Runtime for one action** — host handshake from launch arguments, action lifecycle handling,
   and static state rendering. No generated images, no outbound requests.
4. **Build and package** — copy build into the package folder, and a ZIP whose root is the
   `com.ulanzi…ulanziPlugin/` folder (exploration packaging convention).
5. **Verification assets** — `scripts/check.mjs` style manifest/syntax/asset gate, a `node:test`
   suite over pure-function seams and exact host payloads, and a documented simulator recipe.

### Non-goals (explicitly out)

| Out of scope | Why / when it returns |
|---|---|
| Any API or network access (TheSportsDB live scores, event lookups, polling). | D3. Returns in change 2 with the already-validated Q4–Q6 evidence. |
| Dynamic rendering: generated SVG, `data:` base64 icons, dynamic titles. | D3. Also V3.1-only commands (`setTitle`/`setImage`) are excluded, which sidesteps G3 entirely. |
| Property Inspector UI, settings form, inspector↔service channel, `RandomPort`. | D4. Deferred to a later slice. |
| Hardware acceptance on a physical D200. | D2. A host-only defect is an acknowledged residual risk, not a blocker. |
| Publication/store layout: `store.json`, localization files, cover/banner images, third-party license notices, store-signed packaging. | Requires store-submission evidence that does not exist locally (exploration U10). Deferred. |
| Determining the production install folder path. | Undocumented (G1). Not needed for the simulator path. |
| Multi-action, multi-key, multi-sport, dial/encoder behaviour. | Product scope; change 1 ships exactly one action. |

### Deliberate deviation from a `config.yaml` proposal rule

`rules.proposal` says "Keep the first slice to one selected event in one live-score view". That
rule governs the *product* slice (`football-live-score`), not this scaffold. This change contains
no event selection and no score view by design. Reviewers should read the rule as satisfied by
change 2, not violated here.

## Affected areas

The repository is effectively empty, so this change is almost purely additive.

| Area | Change | Notes |
|---|---|---|
| `package.json` (new) | Scripts + `engines.node >= 20` | Satisfies two `testing.setup_gate` conditions. |
| `.gitignore` (existing, minimal) | Add build/package output ignores | Currently only `/.atl/`; `dist/` and `package/` are missing. |
| `com.ulanzi.<segment>.ulanziPlugin/manifest.json` (new) | One action, static states, D200 targeting | Field set restricted to documented fields. |
| `com.ulanzi.<segment>.ulanziPlugin/assets/*` (new) | Static icons | No generated art. |
| `src/plugin/*.js` (new) | CJS host client + action lifecycle | Static state only. |
| `scripts/{check,build,package}.mjs` (new) | Gates + packaging | Land the remaining setup-gate commands. |
| `test/*.test.js` (new) | `node:test` + `node:assert/strict` | Pure seams plus exact host payload assertions with `host.send` stubbed. |
| `README.md` (new) | Build/run/simulator recipe | Carries the documented manual verification path from D2. |
| `openspec/specs/**` | Later phase | Not written by this proposal. |

No existing product code exists to break. The only behavioural surface at risk is what a host
does with the manifest and the runtime.

## External assumptions

`rules.proposal` requires stating which external behaviors are assumed and how each is evidenced.
Each row below is an assumption this change encodes, its evidence, and how it will be confirmed.

| # | Assumption encoded | Evidence | Confirmation path |
|---|---|---|---|
| A1 | The host launches a `.js` plugin under Node v20.12.2 with `argv[2]`=address, `argv[3]`=port, `argv[4]`=language. | C7, C8 / S2, S3 | Unit test on argument parsing; simulator connection observation. |
| A2 | Actions arrive as events with `context = uuid___key___actionid`, and inbound messages are answered on the same socket. | C9 / S3, plus the exploration's host-client map and sibling implementations | Exact-payload unit tests with a stubbed transport; simulator observation. |
| A3 | Manifest keys `Author, Name, Icon, Version, CodePath, Type, UUID, Actions` are required; `Devices`, `Controllers`, `state`, `DisableAutomaticStates`, `Software.MinVersion`, `PropertyInspectorPath` are optional; `MinimumVersion` is deprecated; 4-segment plugin UUID and longer action UUID. | C2, C3, C4, C5 / S2 | `scripts/check.mjs` asserts the field set; simulator parses the manifest or fails visibly. |
| A4 | `Banner` and `Detail` are not part of the documented manifest contract and will not be emitted. | C6 / S2 (absence in primary source) | Kept out of the manifest; if a host requires them, that surfaces as a simulator load failure, recorded rather than guessed. |
| A5 | Declaring `PropertyInspectorPath` is unnecessary for an action without an inspector. | C3 / S2 | Simulator: dragging the action must not require an inspector page. |
| A6 | The simulator is a partial, reference-only surface: port 39069, manual main-service start, no `setactive`, vendor states desktop behaviour is the source of truth. | C17, C18 / S5 | The recipe documents these limits; the recipe is a manual observation, never a pass/fail gate for host-specific behaviour. |
| A7 | Zero-runtime-dependency CJS is viable for the host protocol (hand-rolled WebSocket over `node:net` and a hand-rolled ZIP writer). | Exploration strategy A, validated in FlightInfoPlugin | Frame parse/encode and payload unit tests; `npm run check`; manual unzip inspection of the produced package. |
| A8 | **No TheSportsDB behavior is assumed by this change.** | C22–C40 exist but are unused here (D3) | Nothing to confirm in this slice; the evidence stays carried for change 2. |

Anything not listed above is not assumed by this change and MUST NOT be invented during design or
implementation — the same rule `config.yaml` already states for SDK and API fields.

## Residual gaps carried forward

Carried unchanged from `research.md`. None blocks this change under D1–D4; none is resolved.

| Gap | Statement | Status in this change |
|---|---|---|
| G1 | Production install directory path is undocumented (C21); only auto-detection after install to a "designated folder" is documented. | Carried, non-blocking: no hardware install gate (D2). A real-hardware sideload recipe stays unverified. |
| G2 | No official caching policy statement exists in the retrieved corpus (C40). | Carried, not exercised: no network path is in scope (D3). Bind to the documented 30 rpm limit when polling arrives. |
| G3 | The installed UlanziStudio version is unknown, so V3.1 command availability (3.3.0+) cannot be settled from documentation. | Carried, not exercised: static icon/state only, and V3.1-only commands are excluded (D3). |

Also still open from exploration and outside the selected research scope: U5 (hardware SVG raster
behaviour), U6 (`statelist.type` semantics), U7 (`paramfromplugin` size limits), U10 (store layout).
U5 and U7 lose practical weight under D3/D4 but are not resolved.

## Risks and mitigations

| # | Risk | Impact | Mitigation | Residual |
|---|---|---|---|---|
| R1 | Hand-rolled WebSocket/`node:net` client (handshake, masked frames, frame parsing) is subtly wrong. | Plugin silently never connects on real hardware. | Unit-test frame encode/parse and the handshake as pure functions; assert exact outbound payloads with the transport stubbed; record a simulator connection observation. | A host-specific defect can survive, because hardware acceptance is not a gate (D2). |
| R2 | Manifest field or version-key assumption is wrong for the user's host build (e.g. an undocumented key is actually required). | Package fails to load. | Restrict the manifest to documented fields (C2–C5); `check.mjs` asserts the field set; A4 is recorded as an absence-in-primary-source assumption rather than a guess. | Host-build variance remains untested without a hardware or host-version check. |
| R3 | Hand-rolled ZIP writer (CRC32, correct root folder) produces a package the host rejects. | Package cannot be installed. | Verify the archive layout; keep the `com.ulanzi…ulanziPlugin/` folder at the ZIP root; manual unzip inspection in the recipe. | Store-signed layout requirements are unknown (U10) and out of scope. |
| R4 | Simulator cannot substitute for the desktop host (no `setactive`, manual start, reference-only output). | Verification confidence is lower than it appears. | Treat simulator observations as evidence, not as acceptance; keep the automated suite as the pass/fail gate; document the limits in the recipe. | Host-only behaviours stay unverified, by design. |
| R5 | Scope creep: research already holds validated TheSportsDB evidence, inviting an early network or dynamic-rendering slice. | Blows the review budget and violates D3. | Non-goals are explicit; specs/design must reject network and generated-image requirements for this change. | Discipline risk only; no technical remnant. |
| R6 | Review budget exceeded (estimate ~700–1050 lines vs a 400-line budget). | Reviewer fatigue; unclear review boundary. | Plan 3 chained slices (skeleton → runtime → checks/tests), each independently reviewable; surface the delivery decision as `ask-on-risk`, do not invent a chain strategy. | Slice sizes are estimates until design; a slice may still need splitting. |
| R7 | Naming/identity mistakes (package segment, UUID shape, action UUID, duplicated version). | Fails the manifest gate or the host's plugin list. | Deterministic naming rules from the exploration; `check.mjs` asserts the main UUID is 4 segments and the action UUID extends it; keep `package.json` and `manifest.json` versions in sync. | Version drift returns on every future release; the check only covers this change's baseline. |

### Considered and rejected for this change

Using the official vendored Node SDK or `ws` + esbuild (strategy B) would remove R1 and R3 by
replacing local code with maintained dependencies. It is rejected here because D1 is confirmed and
because it imports a lockfile, a license-notice gate and an ESM/CJS bundling step into the first
review. If the hand-rolled client proves defective on a host, switching to strategy B is a
**separate product decision requiring explicit user consent** — this change must not adopt it
silently.

## Rollback

Rollback is cheap and complete, because this change publishes nothing and migrates no data.

| Level | Action | Result |
|---|---|---|
| Slice | Revert the slice's commit(s) and delete its added files. | The repository returns to the prior empty-scaffold state; remaining slices are unaffected because no slice depends on another's runtime behaviour to be revertible. |
| Change | Revert all slices and remove the package folder and scripts. | Repository is byte-for-byte the bootstrap state (`.gitignore`, `.pi/`, `openspec/`); `strict_tdd` returns to failing closed, which is the pre-change condition. |
| Consumer | Nothing is installed, published, registered or emailed by this change. | No external cleanup, revocation, or user communication required. |

No rollback path requires network, credentials, store actions, or hardware access. The only
irreversible cost is review effort already spent.

## Success criteria

Completion is judged on evidence produced in this change, without hardware.

- [ ] `package.json` exists with `engines.node >= 20` and `check`/`test`/`build`/`package` scripts,
      satisfying the `testing.setup_gate` command conditions.
- [ ] `npm run check` passes: manifest required fields present, action UUID extends the 4-segment
      plugin UUID, referenced assets exist, and `node --check` is clean across plugin sources.
- [ ] `npm test` runs `node --test test/*.test.js` green, covering the pure seams and exact host
      payloads with the transport stubbed.
- [ ] `npm run build` produces the `com.ulanzi.<segment>.ulanziPlugin/` package output.
- [ ] `npm run package` produces a ZIP whose root is the `com.ulanzi…ulanziPlugin/` folder.
- [ ] Exactly one action is declared, targeted at the D200, with static states and no
      `PropertyInspectorPath`.
- [ ] The runtime performs no outbound network request and generates no dynamic image payload.
- [ ] The README documents the simulator recipe (port 39069, manual main-service start, manual
      event injection) and states the simulator's known limits.
- [ ] No API key, secret, or credential appears anywhere in source, defaults, docs, logs or assets.
- [ ] Residual gaps G1–G3 and assumptions A4/A6 are recorded in the change artifacts as carried
      unknowns, not silently resolved.

## Review-scope awareness

| Item | Value |
|---|---|
| Review budget | 400 changed lines (canonical). |
| Estimated total for this change | ~700–1050 changed lines including tests (exploration estimate), i.e. over budget as a single PR. |
| Planned slices | 1) package skeleton (manifest, assets, build/package scripts) · 2) runtime for one action · 3) checks, tests, README recipe. |
| Delivery decision | `ask-on-risk`. This proposal does **not** choose a chain strategy. When design/apply can confirm slice sizes, the orchestrator must pause and ask the user how to deliver, and `size:exception` is never inferred. |
| Reviewer entry point | Read this proposal, then the slice's own diff; the manifest and the host-payload tests are the two places where intent is easiest to verify. |

## Related changes

| Change | Relation |
|---|---|
| `football-live-score` (change 2) | Consumes this scaffold: adds one configurable football live-score view for a single event, provider evidence, polling cadence and Property Inspector settings. Out of scope here. |
| Exploration U10 / publication gates | Deferred; no store metadata, localization or license notices in this change. |

## Proposal question round (optional, non-blocking)

Per the SDD proposal flow, the user may answer, skip, or ask for a second round. These questions do
**not** re-open D1–D4. Where an answer is absent, the stated default below is what this proposal
assumes, and any answer changes only the design/tasks phases.

1. **Key behaviour.** With a static icon and state only, what should pressing the key do from the
   user's point of view — visibly cycle between the action's declared static states, or show a
   single fixed state and let the press be a no-op beyond host logging? *Assumed default: the press
   sets a static declared state so the `state` command path is exercised; no dynamic image.*
2. **Naming and identity.** What package segment / author handle and display name should ship
   (for example `com.ulanzi.<handle>sportboard.ulanziPlugin`)? *Assumed default: a segment derived
   from the repository name, with identity values treated as replaceable before change 2.*
3. **Simulator as the shipped verification story.** Is a documented simulator recipe acceptable as
   the *only* manual verification for this change, including in the README that end users may read?
   *Assumed default: yes, with the simulator's limits stated plainly (R4).*
4. **Change-2 preview.** Should the scaffold pre-shape anything for the deferred Property Inspector
   (for example an asset or directory convention), or keep the package strictly minimal?
   *Assumed default: strictly minimal, per D4.*
5. **Publication intent.** Should this change record any intent about later store submission, or
   stay silent until store-layout evidence exists (U10)? *Assumed default: stay silent; the change
   only guarantees a locally loadable package.*

## Next step

Proceed to spec delta and design for this change, using the confirmed decisions, the in-scope list,
and the assumption table above as the requirements boundary. Delivery/chaining remains an
orchestrator decision under `ask-on-risk` once slice sizes are known.
