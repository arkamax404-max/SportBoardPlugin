# Plugin Toolchain Specification

## Purpose

Define the deterministic local verification and delivery boundary of this change: the npm
commands that gate correctness, the build and package outputs, the documented UlanziDeck
Simulator recipe and its limits, the no-secrets rule, and rollback-compatible change
boundaries.

## Requirements

### Requirement: Deterministic gate commands exist and pass offline

`package.json` MUST declare `engines.node >= 20` and the scripts `check`, `test`, `build` and
`package` (the `testing.setup_gate` command conditions). All four MUST run offline on Node >= 20
without hardware, network access or credentials, and MUST produce the same result on repeated
runs from a clean checkout. `npm test` MUST run `node --test test/*.test.js`. `npm run check`
MUST validate the manifest required-field set, the plugin/action UUID shape, manifest asset
existence, syntax of all plugin sources, and the absence of `PropertyInspectorPath`.

#### Scenario: Clean-checkout gate run

- GIVEN a clean checkout with Node >= 20 and dependencies installed
- WHEN `npm run check`, `npm test`, `npm run build` and `npm run package` run in sequence
- THEN all four succeed, and a repeat run on the same tree produces equivalent results.

#### Scenario: Check rejects a manifest defect

- GIVEN a manifest missing a required field, carrying a malformed UUID, or referencing a
  missing asset
- WHEN `npm run check` runs
- THEN it fails and names the defect.

### Requirement: Tests cover pure seams and exact host payloads

The `node:test` suite MUST cover the plugin's pure seams — launch-argument parsing, the host
handshake sequence, and host frame encode/parse — and MUST assert exact outbound host payloads
with the transport stubbed, so that no hardware, network or running host is required (A1, A2,
A7).

#### Scenario: Host payloads are pinned by tests

- GIVEN the test suite with the transport stubbed
- WHEN the handshake and a lifecycle response run
- THEN the exact payloads sent to the host match the documented host contract.

### Requirement: Build and package outputs are deterministic and local

`npm run build` MUST produce the `com.ulanzi.<segment>.ulanziPlugin/` package output by local
copying, with no bundler step and no network fetch (D1). `npm run package` MUST produce a ZIP
whose root is that `com.ulanzi…ulanziPlugin/` folder. Build and package outputs (`dist/`,
`package/`) and `node_modules/` MUST be ignored by version control.

#### Scenario: ZIP root layout

- GIVEN the produced package ZIP
- WHEN the archive is unzipped
- THEN its root is the `com.ulanzi…ulanziPlugin/` folder containing `manifest.json`.

#### Scenario: Outputs are not committed

- GIVEN a build and a package run
- WHEN the repository status is inspected
- THEN no `dist/`, `package/` or `node_modules/` output is tracked.

### Requirement: README documents the simulator recipe and its limits

`README.md` MUST document a repeatable UlanziDeck Simulator run recipe (port 39069, manual
main-service start, manual event injection) and MUST state the simulator's known limits: it is
partial and reference-only, its observations are evidence rather than acceptance, and no
physical D200 run is a gate for this change (D2, A6).

#### Scenario: Recipe is complete and honest about limits

- GIVEN a reviewer following the README without prior simulator knowledge
- WHEN they execute the recipe
- THEN they can load the package, drag the single action onto a key, and observe the static
  icon and state, and the README states which host-specific behaviours the simulator cannot
  verify.

### Requirement: No secrets anywhere in the change

No API key, secret or credential MUST appear in source, defaults, documentation, logs or assets
of this change. This change introduces none; the rule is preventive and applies to every added
file.

#### Scenario: Repository scan finds no credentials

- GIVEN the full set of files added by this change
- WHEN they are scanned for API keys, secrets or credentials
- THEN none are present.

### Requirement: Rollback-compatible change boundaries

The change MUST NOT publish, install, register, email or otherwise communicate anything outside
the repository, and MUST NOT migrate or mutate any persisted data. Each slice MUST be
independently revertible, and reverting all slices MUST return the delivered code and
configuration to the bootstrap state (`.gitignore`, `.pi/`, `openspec/`), with `strict_tdd`
back to failing closed. No rollback step MAY require network, credentials, store actions or
hardware access.

#### Scenario: Full revert restores the bootstrap state

- GIVEN all slices of this change are reverted and their added files removed
- WHEN the repository is compared to the pre-change state
- THEN the delivered code and configuration are the bootstrap state and no external cleanup,
  revocation or user communication is required.

#### Scenario: Slice-level revert stays independent

- GIVEN one slice is reverted while the others remain
- WHEN each remaining slice is examined
- THEN none depended on the reverted slice's runtime behaviour to be revertible.

## Carried unknowns (not resolved by this spec)

- A6: the simulator is reference-only; the recipe records its limits instead of presenting it
  as an acceptance gate (D2).
- G1: no hardware sideload recipe exists; the production install path remains undocumented.
- U10: store layout (`store.json`, localization, cover/banner images, license notices) is out
  of scope and deferred until store-submission evidence exists.
