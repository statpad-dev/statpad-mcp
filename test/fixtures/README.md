# Test fixtures

The tests never call the network. A stubbed `fetch` in `test/helpers/stub.ts` routes each request to these files.

## Public samples

These files are copied unchanged from the public samples listed at https://statpad.dev/samples/manifest.json. No key is needed to download them.

- `manifest.json` is the sample index, plus an entry in the same shape for the NBA game below.
- `leagues.json` is `GET /v1/leagues`.
- `nfl-bills-at-vikings/` is Bills at Vikings on November 9, 2026, a final with 187 plays and 68 players in the box score. It has `game.json`, `game-live.json` with the same game in the fourth quarter, `plays.json`, `play-groups.json`, `boxscore.json`, `roster.json` and `changes.ndjson`, the game's full change stream of 1,260 changes.
- `epl-man-utd-aston-villa/` is Aston Villa at Manchester United on November 8, 2026. It has `game.json`, `plays.json`, `boxscore.json` and `roster.json`.
- `nhl-panthers-at-capitals/` is Florida at Washington on November 7, 2026, a final, 3 to 4, with 36 skaters and 2 goalies in the box score. It has `game.json`, `plays.json`, `boxscore.json` and `roster.json`.

To refresh them, download each file again from `https://statpad.dev/samples/<dir>/<file>` and rerun the tests. The tests assert real values from these games, so new samples need new assertions.

## Captured from staging

Statpad publishes no basketball sample yet, so this game was read from Statpad's staging API. It holds game and player data only, with no keys or account data.

- `nba-bucks-at-knicks/` is Milwaukee at New York on November 10, 2026, a final, 85 to 117, with 454 plays and 27 players in the box score. It has `game.json`, `plays.json`, `play-groups.json`, which is empty because basketball has no drives, `boxscore.json`, `roster.json` and `changes.ndjson`, the game's full change stream of 511 changes.

`leagues.json` is still the public sample, so `list_leagues` in the tests doesn't return nba, though the stub serves it.

## Built from the API spec

Statpad publishes no samples of `listGames` or `listTeams`, so the stub builds those responses itself.

- `openapi/listGames.json`, `openapi/listTeams.json` and `openapi/getGame.json` are the examples of those operations in the private API repo's `api/openapi.yaml`, copied unchanged.
- The stub's NFL schedule is the `listGames` example game, Jacksonville at Baltimore, plus the Bills at Vikings sample game. Its NFL teams are the `listTeams` example teams plus the two sample teams. The `listTeams` example has a `next_cursor`, but the stub answers with one page and a null cursor.
- The stub's NCAAF schedule is the game in the `getGame` example, Boise State at Colorado State, in progress in the fourth quarter. It is the only fixture with period scores.
- The stub's Premier League schedule is the Aston Villa at Manchester United sample game.
- The stub's NBA schedule is the Bucks at Knicks game.
- The stub filters the schedule by `date` and `tz`, by `from` and `to`, and by `team_id` the way the API does, so the clock tests exercise real date math.

Tests that need other data, such as a 2,500-play game or teams with accented names, build it inline from these files.
