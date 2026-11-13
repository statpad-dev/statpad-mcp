# @statpad/mcp

[![CI](https://github.com/statpad-dev/statpad-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/statpad-dev/statpad-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An MCP server that lets AI agents read [Statpad](https://statpad.dev), a live sports data API. Connect it to Claude, Cursor or any MCP client, and the agent can look up schedules, live scores and game situations, play-by-play, drives and box scores for the leagues on your plan.

It runs on your computer over stdio, needs Node.js 20 or later, and only reads data.

## Get a key

Create an API key on the Keys page of [your Statpad account](https://app.statpad.dev). Create a new key for the MCP server instead of reusing one from an app. Every key on an account shares one request rate and one monthly allowance, so an agent that makes many calls slows down your production apps too. A key of its own lets you see its usage on the Keys page, and revoke it without touching anything else.

## Set it up

Each client below starts the server with `npx`, which downloads the package the first time. Replace `sporty_...` with your key.

### Claude Code

```sh
claude mcp add statpad -e STATPAD_API_KEY=sporty_... -- npx -y @statpad/mcp
```

### Claude Desktop

Open Settings, then Developer, then Edit Config, and add the server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "statpad": {
      "command": "npx",
      "args": ["-y", "@statpad/mcp"],
      "env": { "STATPAD_API_KEY": "sporty_..." }
    }
  }
}
```

Restart Claude Desktop after you save the file.

### Cursor

Add the server to `~/.cursor/mcp.json` for every project, or to `.cursor/mcp.json` in one project:

```json
{
  "mcpServers": {
    "statpad": {
      "command": "npx",
      "args": ["-y", "@statpad/mcp"],
      "env": { "STATPAD_API_KEY": "sporty_..." }
    }
  }
}
```

Don't commit a project's `.cursor/mcp.json` with a key in it.

### Other clients

Any client that launches stdio servers works. The command is `npx -y @statpad/mcp`, and the server reads its key from the `STATPAD_API_KEY` environment variable. On Windows, a client that can't find `npx` may need the command `cmd` with the arguments `/c npx -y @statpad/mcp`.

The server checks the key's format when it starts. If `STATPAD_API_KEY` is missing or isn't shaped like a Statpad key, the server prints why and exits, and your client shows it as failed to start.

## Tools

| Tool | What it returns |
| --- | --- |
| `list_leagues` | The leagues your key can read, with each league's alias, name, sport and level. |
| `find_teams` | Teams in one league and their ids, matched by name, city or abbreviation, ignoring case and accents. |
| `find_games` | One league's games for a day, a time range of up to 31 days, or the games live right now, with ids, status, start time, teams and scores. It can narrow to one team. |
| `get_game` | One game's status, score and live situation, such as period, clock, possession, and down and distance, with the time Statpad last updated it. |
| `get_box_score` | Player stat lines grouped by category, filtered by team, player or category. |
| `get_plays` | The latest plays, the scoring plays or the drives, and what changed since an earlier call. |

Statpad covers the NFL, NCAA Division I FBS football and the English Premier League today. `list_leagues` returns the leagues your plan includes, and the agent checks it instead of assuming.

Ask questions in your own words, such as "What's the score of the Bills game?", "Who led the Vikings in receiving on Sunday?" or "What happened on the last drive?". The agent picks the tools.

## What isn't available yet

Statpad doesn't serve these yet. The server's instructions list them, so the agent tells you they're unavailable instead of guessing:

- standings
- injuries and transactions
- team rosters and depth charts
- betting odds
- season stats and league leaders
- player profiles and player search
- team totals and score by period in box scores

For a team total, the agent can add up player lines, and it says when it did. Statpad started collecting each league in November 2026, so earlier games aren't there. A game appears in the schedule about 10 minutes before kickoff, so a later day's schedule is empty until then.

## Limits and budgets

The server keeps each tool call small, so an agent can't run up your usage by accident:

- A tool call sends at most 3 requests to Statpad, and gives up after 10 seconds.
- The server retries a failed request once, and never retries a `quota_exhausted` answer.
- A result aims for about 2,000 tokens and never goes past about 6,000. When it trims a list, it says so and tells the agent how to ask for the rest, such as filtering a box score by team.
- When less than 5% of your monthly allowance is left, every result carries a warning that the agent passes on to you.

Every request the server sends counts against your plan like any other request, including one that answers 304. The [rate limits guide](https://statpad.dev/docs/get-started/rate-limits) explains the rate and the allowance.

## Privacy

The server runs on your computer. Your key stays in your MCP client's configuration and in the server's environment. The server sends the key only to `api.statpad.dev`, in the `Authorization` header, and never puts it in a tool result or a log line. It logs one line per tool call to stderr, with the tool name, request count, duration and size, and never the arguments or the data.

The agent's questions and the data it reads go to whichever AI model your client uses, under that client's terms.

## Docs search

To let an agent search the Statpad documentation, add the separate docs MCP server at `https://statpad.dev/docs/_mcp/server`. It needs no key. For example, in Claude Code:

```sh
claude mcp add --transport http statpad-docs https://statpad.dev/docs/_mcp/server
```

## Troubleshooting

| Result | What to do |
| --- | --- |
| `unauthorized` | Statpad doesn't accept the key. Copy a current key from the Keys page into `STATPAD_API_KEY` and restart the client. |
| `forbidden` | The key can't read that league. Either your plan doesn't include it, or the alias is wrong. `list_leagues` shows what the key can read. |
| `rate_limited` | The account is sending requests too fast, perhaps from another app. Wait a few seconds. |
| `quota_exhausted` | The account used this month's allowance. The result says when it renews, or you can upgrade the plan. |

Set `STATPAD_MCP_LOG=debug` in the server's environment for more detail in your client's MCP log, or `off` to silence it.

## Versioning

The server follows [semantic versioning](https://semver.org). Until 1.0, a minor release can change tool names, arguments and results. `npx -y @statpad/mcp` runs the latest release, so pin a version such as `@statpad/mcp@0.1` if you need a fixed one.

## Support

Report bugs in [GitHub issues](https://github.com/statpad-dev/statpad-mcp/issues). For questions about the API, your account or your data, see the [Statpad docs](https://statpad.dev/docs). To change the server itself, read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
