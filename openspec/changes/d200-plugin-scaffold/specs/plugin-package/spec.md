# Plugin Package Specification

## Purpose

Define the loadable UlanziStudio plugin package artifact produced by this change: the
`com.ulanzi.<segment>.ulanziPlugin/` folder, its manifest, its static assets and its identity.
This is the surface UlanziDeck Simulator and UlanziStudio parse before any runtime code runs.

Scope guard: this scaffold ships exactly one static D200 action. Property Inspector
integration, network-backed behaviour and dynamic rendering are owned by later changes
(D3, D4). Sport selection is not configurable here; the `config.yaml` rule "keep sport
selection configurable with football as the shipped default" is satisfied by change 2
(`football-live-score`), not by this scaffold, which has no settings surface by D4.

## Requirements

### Requirement: Package folder layout

The repository MUST contain a plugin package folder named `com.ulanzi.<segment>.ulanziPlugin`
containing `manifest.json` and every asset the manifest references, where `<segment>` is a
stable identity segment of the author's choosing.

#### Scenario: Package folder is self-contained

- GIVEN the package folder at the repository root
- WHEN the folder is inspected without any build step
- THEN `manifest.json` and all icon/state assets it references are present inside the folder.

### Requirement: Manifest declares documented required fields only

`manifest.json` MUST declare `Author`, `Name`, `Icon`, `Version`, `CodePath`, `Type`, `UUID`,
and `Actions`. It MUST NOT declare keys outside the documented contract: `Banner` and `Detail`
MUST NOT be emitted (assumption A4: absent from the primary source), the deprecated
`MinimumVersion` MUST NOT be emitted, and `PropertyInspectorPath` MUST be absent because this
change has no Property Inspector (D4, A5). Documented optional keys (`Devices`, `Controllers`,
`state`, `DisableAutomaticStates`, `Software.MinVersion`) MAY be used.

#### Scenario: Manifest field gate

- GIVEN `manifest.json` in the package folder
- WHEN `npm run check` validates it
- THEN all required fields are present and no `Banner`, `Detail`, `MinimumVersion` or
  `PropertyInspectorPath` key exists.

#### Scenario: Host-side manifest rejection is recorded, not guessed around

- GIVEN a host build that requires a manifest key this spec excludes as undocumented
- WHEN the package is loaded in the UlanziDeck Simulator
- THEN the load failure is observable and is recorded as evidence against assumption A4,
  and the key is not silently added without a decision.

### Requirement: Plugin identity is consistent and convention-shaped

The plugin UUID MUST have exactly 4 segments in the `com.ulanzi` convention. The action UUID
MUST extend that plugin UUID. The manifest `Version` MUST equal the `package.json` `version`.
Identity values (segment, display name, UUID) MUST be consistent across the package and MAY be
replaced before change 2 without violating any other requirement.

#### Scenario: Identity consistency gate

- GIVEN `manifest.json` and `package.json`
- WHEN `npm run check` runs
- THEN the plugin UUID has 4 segments, the declared action UUID extends it, and both versions
  are identical.

### Requirement: Exactly one static D200 action

The manifest `Actions` MUST declare exactly one action. The action MUST target the D200 device.
The action MUST declare static states. It MUST NOT declare dynamic rendering, network-backed
behaviour, or a Property Inspector (D3, D4).

#### Scenario: Single action declaration

- GIVEN the `Actions` object in `manifest.json`
- WHEN the manifest is read
- THEN exactly one action is declared, targeted at the D200, whose states are static and whose
  declaration contains no Property Inspector reference.

### Requirement: Static assets only

Every icon and state image MUST be a static file shipped inside the package folder. The package
MUST NOT contain generated SVG, `data:`/base64 image payloads, or any dynamically produced art
(D3).

#### Scenario: Asset references resolve to static files

- GIVEN the manifest `Icon` and the action's declared state images
- WHEN `npm run check` resolves each referenced asset path
- THEN each path exists inside the package folder as a static file, and none is generated at
  runtime.

## Carried unknowns (not resolved by this spec)

- G1: the production install folder path is undocumented; this spec states no install-path
  requirement (non-blocking under D2).
- G3: the installed UlanziStudio version is unknown; this spec excludes V3.1-only commands
  instead of assuming their availability.
- A4: the `Banner`/`Detail` exclusion rests on absence in the primary source; a host requiring
  them would surface as a simulator load failure to be recorded, not silently patched.
