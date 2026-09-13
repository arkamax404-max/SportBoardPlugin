# Technical map: minimal verifiable Ulanzi D200 Node plugin scaffold (change 1 of 2)

Exploration notes only — no implementation, no design decisions locked. Source of truth for every
statement below is a file in a local repository, cited as `path:line-range` or `path`. Anything
without a citation is listed later as an open unknown.

## Answer first

| Question | Finding |
|---|---|
| Is SportBoardPlugin usable as-is? | No. It is an empty Git repo (no refs under `.git/refs/heads`, no remote) containing only `.gitignore`, `.pi/gentle-ai/sdd-preflight.json` and the OpenSpec bootstrap. |
| Best reusable template | `/mnt/d/Desarrollo/FlightInfoPlugin` — a complete, one-action, D200-scoped Node plugin with zero npm runtime dependencies and a matching `node:test` suite. |
| Second reference | `/mnt/d/Desarrollo/SimpleCountDownPlugIn` — same package shape, but esbuild-bundled CJS + `ws` + `yazl`, plus publication gates (localization, store, license notices). |
| Official SDK | `/mnt/d/Desarrollo/d200-stream-deck/UlanziDeckPlugin-SDK-main` — local clone is partial: `common-node/` and `common-html/` are unpopulated submodules and `manifest.md` is **absent**. A complete vendored copy of `plugin-common-node` exists in `WeatherPlugin`. |
| Does the scaffold fit one 400-line review? | No. Faithful scaffold ≈ 700–1,050 lines including tests. It needs 3 chained slices (see Budget). |
| Is there prior sports/TheSportsDB art locally? | None found in the D200 sibling repositories inspected. |

## Quick path for the proposal phase

1. Reuse the FlightInfoPlugin file layout verbatim, renaming the package segment, UUIDs and titles.
2. Choose strategy A (copy build, no dependencies) for the scaffold; revisit only if a WebSocket
   client bug appears on hardware.
3. Split the scaffold into the three slices in the Budget table; keep `openspec/config.yaml`
   `setup_gate` conditions satisfied by the end of slice 3.

## Workspace state (SportBoardPlugin)

| Path | Content |
|---|---|
| `.gitignore` | `/.atl/` only — no `dist/`, no `package/`, no `node_modules/` rule yet. |
| `.pi/gentle-ai/sdd-preflight.json` | auto mode, openspec store, `ask-on-risk`, 400-line budget, Engram available. |
| `openspec/config.yaml` | Project context, planned stack, planned test convention, secrets rule, and a `testing.setup_gate` that promotes `strict_tdd` to true once `package.json` + `npm test` + `npm run check` + `npm run build` exist. |
| `openspec/changes/`, `openspec/specs/` | Empty (`.gitkeep`, empty `archive/`). |

Consequence: the scaffold change is the exact moment the repo stops being "TDD fails closed".
`config.yaml` documents the target commands, so the scaffold must land them, not invent new ones.

## Reference anatomy — FlightInfoPlugin

```
package.json                     engines.node >=20; check|test|build|package
scripts/check.mjs        (71)     manifest field gate + asset existence + node --check sweep
scripts/build.mjs        (9)      cpSync src/plugin/ -> <pkg>/dist/
scripts/package.mjs      (107)    hand-rolled ZIP writer, package folder name at ZIP root
src/plugin/main.js       (220)    CJS entry: context map, adaptive poll timer, refresh guard
src/plugin/host-client.js(142)    WS over node:net: handshake, frame parse/encode, state commands
src/plugin/settings.js   (27)     normalizeSettings + DEFAULT_SETTINGS (pure, no host I/O)
src/plugin/flight-provider.js(12) provider-neutral boundary + toFlightQuery
src/plugin/airlabs-flight-provider.js(106) fetch -> normalized status | {kind:'unavailable', reason}
src/plugin/flight-status-service.js(18)  provider factory + swallow-throws-as-unavailable
src/plugin/presentation.js(83)    status -> {state, text} lines, placeholders, credential-free
src/plugin/flight-image-renderer.js(48)  5-line SVG -> data:image/svg+xml;base64
<pkg>/manifest.json      (37)     one action, 4 states, Devices ["D200"], Software.MinVersion 2.1.4
<pkg>/property-inspector/flight/inspector.html(40) .js(59) .css(7)
<pkg>/property-inspector/lib/host-api.js(36)  minimal window.$UD shim
test/flight-domain.test.js(510)   one CJS file, node:test + node:assert/strict
store.json, README.md, resources/store/*.png
```

Naming and identity rules observed in code:

| Rule | Evidence |
|---|---|
| Package directory `com.ulanzi.<segment>.ulanziPlugin` | FlightInfo `com.ulanzi.flightinfo.ulanziPlugin`; SimpleCountDown `com.ulanzi.arkamax404simplecountdown.ulanziPlugin` (author handle inside segment). |
| Main UUID `com.ulanzi.ulanzistudio.<plugin>` — exactly 4 segments | `plugin-common-node/README.md` instruction 4; FlightInfo and SimpleCountDown manifests comply. |
| Action UUID = main UUID + `.<action>` (> 4 segments) | `plugin-common-node/README.md` instruction 5; `check.mjs` asserts `action.UUID === \`${manifest.UUID}.status\``. |
| Version is duplicated in `package.json`, `manifest.json`, git tags `v0.1.x` | FlightInfo `.git/refs/tags` v0.1.0…v0.1.3, `package.json` 0.1.4, `manifest.Version` 0.1.4. |
| `.gitignore` excludes `dist/` and `package/` | FlightInfo `.gitignore`. |

## Two packaging strategies (decision needed in the proposal)

| Aspect | A — FlightInfo (copy build, zero deps) | B — SimpleCountDown (bundle + deps) |
|---|---|---|
| Runtime | CommonJS, `require("./x.js")`, `node --check` clean | Root `package.json` `"type": "module"`, ESM source, esbuild → CJS `dist/plugin.js` |
| WebSocket | Hand-rolled over `node:net` (142 lines, masked frames) | `ws@8.21.3` dependency, 60-line client |
| ZIP | Hand-rolled CRC32 writer (107 lines) | `yazl@3.3.1` |
| `node_modules` in package | None | Bundled into `dist/plugin.js`; `THIRD_PARTY_NOTICES.md` must embed the full `ws` MIT text (`check.mjs` + `test/license-notice.test.js`) |
| Cost | More local code to review once | npm install, lockfile, license gate, build dependency |
| `CodePath` | `dist/main.js` | `dist/plugin.js` |

Both are proven in-repo. A keeps the first change reviewable and dependency-free; B is the path the
other author chose when the WebSocket handling and packaging logic grew.

## Property Inspector architecture (shared by both references)

| Element | Pattern |
|---|---|
| Global API | `property-inspector/lib/host-api.js` defines `window.$UD` with only `connect(uuid)`, `on(name, handler)`, `sendParamFromPlugin(param)`. |
| Identity | Read from `location.search`: `uuid`, `key`, `actionid`, and optional `address`/`port` (default `127.0.0.1:3906`). |
| Inbound settings | Listeners for **all three** of `add`, `paramfromapp`, `didReceiveSettings`; payload is `message.param \|\| message.settings`. |
| Outbound settings | Single `paramfromplugin` message containing the whole settings object. |
| Secret handling | `type="password"` field, value cleared from the DOM right after save, "configured (masked)" `<output>` state, explicit **Clear saved API key** button. Saved key is kept in JS state only. |
| Validation split | SimpleCountDown moves validation into `property-inspector/countdown/settings.js`, an IIFE that publishes `root.CountdownSettings`, and tests it in Node with `node:vm` (`test/property-inspector-settings.test.js`). FlightInfo keeps validation only runtime-side in `src/plugin/settings.js`. |
| Theming | `check.mjs` requires `:root { background: transparent; }` in the inspector CSS (SimpleCountDown only). |

## Host/runtime protocol map (what the plugin can rely on)

| Fact | Evidence |
|---|---|
| Host is a local WebSocket server, default `127.0.0.1:3906`. | `host-client.js` defaults; `plugin-common-node/README.md` §4. |
| Launch args from host: `argv[2]` address, `argv[3]` port, `argv[4]` language. | `plugin-common-node/README.md` §4; both sibling clients read `argv.slice(2)` as `[address, port]`. |
| Every message must be answered: `send(data.cmd, { code: 0, ...data })`. | `host-client.js` `#receive`. |
| `context = uuid___key___actionid`; for `clear` it is per `param[]` item. | `encodeContext`/`decodeContext`; README "Special Parameter: context". |
| Icon command payload: `cmd:"state"`, `param.statelist:[{uuid,key,actionid,type,data\|state,textData,showtext}]`; `type:0` state index, `type:1` base64 image. | `setStateIcon`/`setBaseDataIcon` + `test/flight-domain.test.js` exact-payload assertion. |
| Event names available: `connected add run keydown keyup setactive clear paramfromapp paramfromplugin didReceiveSettings didReceiveGlobalSettings sendToPlugin sendToPropertyInspector selectdialog dialrotate …` | `plugin-common-node/libs/constants.js`. |
| Official SDK is ESM, `ws@^8.18.0`, Apache-2.0, "protocol V3.1.0"; adds `setState/setImage/setTitle`, `setSettings/getSettings`, `toast`, `alert`, `logMessage`, `openUrl`, `Utils.getPluginPath()`, `RandomPort`. | vendored `WeatherPlugin/.../plugin-common-node/{README.md,package.json,LICENSE,libs/constants.js}`. |
| Debug flags for the real host: `--log`, `--nodeRemoteDebug` (+ `"Inspect"` in manifest), `--webRemoteDebug`. | `plugin-common-node/README.md` §Debugging. |
| Simulator exists at `UlanziDeckSimulator` (HTTP/WS on port **39069**, plugins auto-parsed from `UlanziDeckSimulator/plugins`), but it "does not actively send `setactive`", does not support `openview`/`selectdialog`, and the main service must be started by hand. | `UlanziDeckSimulator/README.md`, `app.js:10`, `server/clients.js:243`, `static/index.html:15`. |

## Rendering pattern for D200 content

| Item | Observed |
|---|---|
| Why images | Physical D200 text metadata is unreliable, so dynamic content is generated SVG. `README.md` (FlightInfo) states this explicitly; both siblings do the same. |
| Encoding | `` `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` `` sent as `type:1`. |
| Canvas | FlightInfo 196×196 (`rx=12`, bg `#101820`); SimpleCountDown 144×144 (`rx=26`, bg `#11151b`). Native D200 resolution is **not** evidenced locally. |
| Line budget | FlightInfo uses exactly 5 lines with a per-line `{y, fontSize, fontWeight, color}` table and a separate 3-line layout for the unavailable state. |
| Safety | `escapeXml()` on every line; every display value passes a type/regex guard and falls back to `---`; tests assert no credential leaks into the SVG. |
| Fallback | Loading state (`setStateIcon(context, 0)`) uses the manifest's static `States[0]` icon; `createFlightImage` returns `null` for the loading view so the static icon survives. |

## Test and build conventions to carry over

| Convention | Reference command |
|---|---|
| Pure-function seams only in tests (poll policy, settings, presentation, renderer, provider normalizer, exact host payload with `host.send` stubbed). | `node --test test/*.test.js` |
| `node:assert/strict`, CJS `require`, one flat test file per domain area. | FlightInfo test file |
| Browser PI logic made Node-testable via IIFE + `globalThis` export + `vm.runInContext`. | SimpleCountDown `test/property-inspector-settings.test.js` |
| Manifest/asset/syntax gate before anything else. | `npm run check` |
| Release gate chain: `check → test → build → package`. | FlightInfo `"package"` script |
| ZIP must contain the `com.ulanzi…ulanziPlugin/` folder at its root. | `scripts/package.mjs` last line |

## Budget against the 400-line review limit

| Slice | Contents | Est. lines |
|---|---|---|
| 1.1 Package skeleton | `package.json`, `.gitignore`, `README.md`, `<pkg>/manifest.json`, `assets/*.svg`, `scripts/build.mjs`, `scripts/package.mjs` | 300–420 |
| 1.2 Runtime | `host-client.js`, `settings.js`, `presentation.js`, `image-renderer.js`, `main.js` (static/echo state first, polling later) | 350–500 |
| 1.3 Inspector + gates | `property-inspector/**`, `scripts/check.mjs`, `test/*.test.js` | 300–500 |

Copy sources reduce authoring effort but not changed-line count, so chaining is required, not
optional. Alternative to reach a smaller first PR: hand-written minimal ZIP via a `yazl` dev
dependency (≈25 lines instead of 107) at the cost of strategy B's lockfile.

## Unknowns requiring source-backed external research

| # | Unknown | Where evidence must come from | Blocks |
|---|---|---|---|
| U1 | Canonical manifest field spec — are `Devices`, `Controllers`, `state`, `DisableAutomaticStates`, `Detail`, `Banner`, `PrivateAPI` official and mandatory? | `UlanziDeckPlugin-SDK/manifest.md` (referenced by `plugin-common-node/README.md`, missing in the local clone) | 1.1 |
| U2 | `Software.MinVersion "2.1.4"` (both D200 siblings) vs `Software.MinimumVersion "6.1"` (official demos) — key name, value scheme, and which host accepts `Devices:["D200"]`. | Official manifest doc + current UlanziStudio release notes | 1.1 |
| U3 | Protocol V3.1 display commands (`setImage`, `setTitle`) require "UlanziStudio 3.3.0 or later" while shipped D200 plugins declare min 2.1.4. Which API level is safe on the user's host? | Official host changelog/version docs; then a live check on the user's install | 1.2 |
| U4 | Whether a **Node**-type plugin (`CodePath` = `.js`) can be exercised in `UlanziDeckSimulator`, or only HTML plugins; the simulator hint shows `node.exe app.js 127.0.0.1 3906` while its own port is 39069. | Run the simulator locally and capture the real start URL/port behaviour | 1.1 verification story |
| U5 | Real D200 icon raster size and whether SVG data-URL icons render correctly on hardware (FlightInfo README says never exercised on a physical device). | Hardware test by the user, or vendor icon guidance | 1.2 rendering |
| U6 | Exact `statelist.type` semantics (`0` vs `1`), `textData`/`showtext` behaviour, and availability of `setState`/`logMessage` on the D200 host. | Protocol doc + hardware capture of host traffic | 1.2 |
| U7 | Whether the `paramfromplugin` object is size-limited (settings will carry an API key plus league/event identifiers). | Protocol doc; practical test | 1.3 |
| U8 | Whether `WeatherPlugin`'s vendored `plugin-common-node` (Apache-2.0) may be copied into a new plugin package, versus the AGPL-3.0 parent SDK repo. | License texts + upstream repo statements | Strategy choice |
| U9 | Is `ulanzideck-api` published to npm (the vendored `package.json` name is `ulanzideck-api`, `private` not set) — install vs vendor decision. | npm registry | Strategy choice |
| U10 | Whether UlanziStudio accepts the hand-rolled ZIP or requires a store-signed package layout (`store.json`, `en.json`, `zh_CN.json`, cover/banner PNGs). | Store submission doc; SimpleCountDown `check.mjs` expectations are the only local signal | Release step |

## Decisions to pin in the proposal

| Topic | Options |
|---|---|
| Module format | A: CJS everywhere (FlightInfo) · B: ESM source + esbuild CJS bundle (SimpleCountDown) |
| WebSocket | Hand-rolled `node:net` · `ws` dependency · vendored official `plugin-common-node` |
| Verification without hardware | `npm run check` + `node --test` only · add UlanziDeckSimulator run recipe (U4) |
| Initial on-key behaviour | Static icon + state cycling only · `run` → "hello" SVG image (proves `type:1` path) |
| Property Inspector in change 1 | Full settings form deferred to change 2 · minimal echo form now to prove `paramfromplugin` |
| Publication gates (store/localization/licenses) | Now · deferred to a later change (recommended: deferred) |

## Reader checklist

- [ ] Every FlightInfo line count above can be re-measured with `wc -l`.
- [ ] No Ulanzi field is asserted that is not cited here or in the unknowns table.
- [ ] The three scaffold slices each stay at or under the 400 changed-line budget.
