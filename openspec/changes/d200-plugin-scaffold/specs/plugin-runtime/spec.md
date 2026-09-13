# Plugin Runtime Specification

## Purpose

Define what the plugin process MUST do once the host launches it: parse launch arguments,
complete the host handshake, handle the single action's lifecycle, and render only static
state — under the confirmed constraints: CommonJS with zero runtime dependencies (D1),
static-only rendering with no network (D3), no Property Inspector (D4).

Scope guard: the `config.yaml` rule requiring unavailable/loading/stale-data states applies to
network-backed requirements. This change has no network-backed requirement (D3), so no such
states are specified here; they are introduced with change 2 (`football-live-score`).

## Requirements

### Requirement: Launch configuration comes from host launch arguments

The plugin MUST obtain the host connection address, port and language from the launch arguments
supplied by the host (documented as `argv[2]` = address, `argv[3]` = port, `argv[4]` = language;
assumption A1). It MUST NOT require any other configuration source, config file or environment
variable to connect.

#### Scenario: Launch arguments are honoured

- GIVEN the host launches the plugin with an address, a port and a language
- WHEN the plugin starts
- THEN it attempts its host connection against exactly those values.

#### Scenario: Missing launch arguments fail fast

- GIVEN the plugin is launched without the expected launch arguments
- WHEN the plugin starts
- THEN it stops with a clear error instead of guessing connection defaults.

### Requirement: Host connection uses only Node built-ins

The plugin MUST establish and maintain the host connection using only Node.js built-in modules
(the documented WebSocket-over-`node:net` host protocol), with zero npm runtime dependencies
(D1, A7). Inbound host messages MUST be answered on the same connection (A2). The build MUST NOT
introduce a bundler or dependency step to achieve this.

#### Scenario: Zero runtime dependencies

- GIVEN `package.json` and the plugin sources
- WHEN the runtime dependency set and imports are inspected
- THEN no runtime dependency is declared and the connection uses built-in modules only.

#### Scenario: Inbound messages are answered on the same connection

- GIVEN the host sends a message on the established connection
- WHEN the plugin responds
- THEN the response leaves through that same connection.

### Requirement: Action lifecycle for the single declared action

The plugin MUST handle the action lifecycle required to make the one declared action usable on
a key, identifying action instances by the host's context format
(`<plugin-uuid>___<key>___<action-id>`; assumption A2). The runtime MUST assume exactly one
declared action and MUST NOT implement behaviour for actions it did not declare.

#### Scenario: Action appears on a key

- GIVEN the simulator with the package loaded
- WHEN the single action is dragged onto a key
- THEN the runtime handles the resulting lifecycle event for that action's context without
  error.

### Requirement: Rendering is static state only

Rendering MUST be limited to the manifest's static icon and its declared states. On a key press
the runtime SHOULD set one of the action's declared static states (the proposal's assumed
default, exercising the state command path). The runtime MUST NOT generate SVG, MUST NOT send
base64/`data:` image payloads, and MUST NOT use V3.1-only commands (`setTitle`/`setImage`),
whose availability is unresolved (G3).

#### Scenario: Key press sets a declared static state

- GIVEN the action is on a key
- WHEN the key is pressed
- THEN the runtime sends only a state command naming a state declared in the manifest, and no
  image payload.

#### Scenario: No dynamic image payload ever leaves the plugin

- GIVEN any lifecycle or key event during a simulator session
- WHEN all outbound messages are observed
- THEN none contains generated SVG, a `data:` URI, or base64 image data.

### Requirement: No network access beyond the host connection

The plugin MUST NOT open any network connection other than the host connection, and the host
connection MUST NOT be used to reach any endpoint other than the host. No API polling, event
lookups or outbound HTTP requests exist in this change (D3).

#### Scenario: Only the host socket is opened

- GIVEN the plugin runs a full simulator session
- WHEN its remote connections are observed
- THEN the only one is the host connection established from the launch arguments.

### Requirement: No Property Inspector surface

The plugin MUST NOT open a random port, MUST NOT implement an inspector↔service channel, and
MUST NOT depend on any inspector being present (D4).

#### Scenario: No inspector port is opened

- GIVEN the plugin runs a full simulator session
- WHEN its listening sockets are observed
- THEN none is opened for a Property Inspector.

## Carried unknowns (not resolved by this spec)

- G2: no official caching policy is known; no network path exists here to which it would apply
  (D3). Bind to the documented 30 rpm limit when change 2 introduces polling.
- G3: V3.1 command availability is unresolved; this spec excludes those commands instead of
  relying on them.
- U5/U7: hardware SVG raster behaviour and `paramfromplugin` size limits lose practical weight
  under D3/D4 but remain unresolved.
