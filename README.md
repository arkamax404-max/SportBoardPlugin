# SportBoardPlugin

An unofficial Ulanzi Studio plugin for the **Ulanzi D200** that displays the football match nearest to the current time for a team assigned to each key.

## Features

- One independently configured team per D200 key.
- Dynamic competition and team selectors powered by [football-data.org](https://www.football-data.org/).
- The match nearest to the current time is selected automatically; no date input is required.
- Pressing a configured key switches between the last finished match and the active match, or the next upcoming match when none is active.
- Active matches update every two minutes; future fixtures update a local countdown without API requests before kickoff.
- Home and away crests, team names, score or kickoff time, and a match date or same-day `START IN HH:MM` countdown rendered on the key.
- A static red `LIVE` badge for matches in play or paused at half-time.
- A short score-change alert played by the computer, not by the D200.
- A brief amber marker appears on the home, away, or both sides when that score increases.
- Persistent selector cache with explicit on-demand refresh.
- Durable per-key settings through the Ulanzi Studio settings API.
- Zero runtime npm dependencies.

## Requirements

- Ulanzi Studio with a D200 device.
- Windows 10 or later.
- macOS 12 or later is declared compatible but is pending physical validation; it has not yet been tested on macOS hardware.
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

The initial view remains the nearest fixture. Pressing the key then alternates between the most recent `FINISHED` match and the `next` category. `next` prioritizes an active `IN_PLAY`, `PAUSED`, or `LIVE` match; only when none is active does it select the nearest future `SCHEDULED` or `TIMED` fixture. If that side of the toggle has no candidate, the key reports `No finished match` or `No upcoming match`; the next press still switches to the opposite view.

Automatic polling runs every two minutes for an active `IN_PLAY`, `PAUSED`, or `LIVE` match, including across local midnight. For a future `SCHEDULED` or `TIMED` fixture on the same local calendar day, the bottom row shows `START IN HH:MM`, where the value is the remaining duration rounded up to the next minute. The countdown recalculates from the current UTC epoch at every displayed-minute boundary, so delayed callbacks never accumulate drift or show a negative duration. Before the local match day it keeps the localized date and wakes locally at midnight to activate the countdown. These local redraws reuse the displayed fixture and crests and do not call the API, reload crests, alter score/audio state, or show a goal marker.

At the parsed UTC kickoff, the plugin shows `START IN 00:00` and performs exactly one background refresh. If the provider still reports `SCHEDULED` or `TIMED`, polling continues every two minutes until the status changes. Already-due scheduled/timed fixtures enter that cadence immediately. Each context owns only one timer, and long waits are split into safe local timeout chunks without API calls between chunks. Finished, cancelled, postponed, suspended, awarded, and other statuses schedule nothing.

Scheduling compares the parsed kickoff instant and the injected/current clock as epoch milliseconds. Local timezone conversion is used only for display, never for timer decisions.

The first score observed for each key and match establishes a silent baseline. Later home or away score changes for that same live match play one short computer-audio alert, including score corrections. A score increase also draws an amber geometric marker beside the corresponding home or away side for that refresh only; simultaneous increases mark both sides, while corrections do not show a marker. Changing the selected team, competition, view, or match establishes a new silent baseline. Audio playback failure does not interrupt key updates or polling.

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

## Trademark and logo disclaimer

Team names, club crests, competition logos, trademarks and other third-party visual assets displayed by this plugin are the property of their respective owners.

This plugin is an independent, unofficial project and is not affiliated with, endorsed by, sponsored by, or officially connected with any football club, league, federation, competition, or football-data.org.

Match data is obtained through the football-data.org API. Any third-party logos or crests are used solely for identification and informational purposes.

The plugin itself is distributed under the MIT License. The MIT License applies only to the plugin's source code and does not grant any rights over third-party trademarks, logos, crests, names, or other protected assets.

If you are a rights holder and believe any asset is being used improperly, please open an issue in the project repository so it can be reviewed or removed.

## License

Original SportBoardPlugin code is licensed under the [MIT License](LICENSE).
Bundled Ulanzi SDK files retain their Apache License 2.0 terms; see
[Third-party notices](THIRD_PARTY_NOTICES.md).
