# SportBoardPlugin

An unofficial Ulanzi Studio plugin for the **Ulanzi D200** that displays the football match nearest to the current time for a team assigned to each key.

## Features

- One independently configured team per D200 key.
- Dynamic competition and team selectors powered by [football-data.org](https://www.football-data.org/).
- The nearest finished or upcoming match is selected automatically; no date input is required.
- Match-day updates every two minutes while the match is not in a terminal state.
- Home and away crests, team names, score or kickoff time, and match date rendered on the key.
- Persistent selector cache with explicit on-demand refresh.
- Durable per-key settings through the Ulanzi Studio settings API.
- Zero runtime npm dependencies.

## Requirements

- Ulanzi Studio with a D200 device.
- Node.js 20 or later for development.
- A football-data.org API token. Availability of competitions and fixtures depends on the account's plan.

## Install

1. Download or build `package/com.ulanzi.sportboard.ulanziPlugin.zip`.
2. Extract `com.ulanzi.sportboard.ulanziPlugin` into the Ulanzi Studio plugin directory.
3. Restart Ulanzi Studio completely.
4. Add **Sport Board Status** to a D200 key.
5. Open the Property Inspector, enter the football-data.org token, and select a competition and team.

Typical Windows plugin directory:

```text
%APPDATA%\Ulanzi\UlanziDeck\Plugins
```

## Behavior

The plugin requests the selected team's fixtures within a bounded window around the current date and chooses the kickoff with the smallest absolute distance from now. A future fixture wins an exact tie.

Automatic polling runs every two minutes only when the chosen fixture is scheduled for the current local calendar day and its status is not terminal. Future-day, finished, cancelled, postponed, suspended, and awarded fixtures are not polled. Pressing the key still triggers an immediate manual refresh.

## Privacy and security

- The football-data.org token is entered manually and stored through the Ulanzi Studio `setSettings` API.
- The token is never hardcoded or written into the plugin's catalog cache.
- Catalog cache entries are keyed by a SHA-256 token hash.
- Team crest downloads accept only HTTPS URLs from `crests.football-data.org`, reject redirects, validate image MIME types, and enforce a 256 KiB limit.
- Network access is limited to the local Ulanzi Studio WebSocket, football-data.org API endpoints, and football-data.org crest assets.

## Development

```bash
npm run check
npm test
npm run build
npm run package
```

| Command | Purpose |
|---|---|
| `npm run check` | Validate manifest metadata, package structure, assets, and source/build contracts. |
| `npm test` | Run the deterministic Node test suite. |
| `npm run build` | Copy runtime sources into the plugin's `dist/` directory. |
| `npm run package` | Run checks and tests, build the plugin, and create the installable ZIP. |

Generated `dist/`, `package/`, `node_modules/`, local catalog caches, and agent workspace state are excluded from Git.

## Project structure

```text
src/plugin/                         Runtime source
com.ulanzi.sportboard.ulanziPlugin/ Manifest, assets, Inspector, and bundled Ulanzi SDK
test/                               Node test suite
scripts/                            Validation, build, and packaging tools
openspec/                            Design and specification artifacts
```

## Disclaimer

This project is not affiliated with or endorsed by Ulanzi or football-data.org. Team names, crests, competition data, and match data belong to their respective owners and are retrieved at runtime from football-data.org.

## License

Original SportBoardPlugin code is licensed under the [MIT License](LICENSE).
Bundled Ulanzi SDK files retain their Apache License 2.0 terms; see
[Third-party notices](THIRD_PARTY_NOTICES.md).
