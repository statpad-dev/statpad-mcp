# Contributing

This repository is the Statpad MCP server, published to npm as `@statpad/mcp`. It wraps the TypeScript SDK, `@statpad/sdk`, in six read-only tools.

## Development loop

You need Node.js 20 or later. CI uses Node 24.

```sh
npm ci
npm test
```

`npm run check` runs what CI runs: the type check, the tests, the build, and a check that the packed tarball holds only `dist/`, `README.md`, `LICENSE` and `package.json`. Run it before you push. Every script is a Node script, so it works the same in Windows cmd, PowerShell and a Linux shell.

To try the built server in a client, build it and point the client at `dist/stdio.js`:

```sh
npm run build
claude mcp add statpad-dev -e STATPAD_API_KEY=sporty_... -- node /path/to/statpad-mcp/dist/stdio.js
```

The MCP Inspector works the same way:

```sh
npx @modelcontextprotocol/inspector -e STATPAD_API_KEY=sporty_... node dist/stdio.js
```

`STATPAD_BASE_URL` points the server at another API, such as a local `sporty-api`. `STATPAD_MCP_LOG` sets the stderr log level to `debug`, `info`, `warn`, `error` or `off`.

## Layout

- `src/tools/` has one module per tool. Each declares its input and output schemas with zod and a `run` function that takes the arguments and a `CallContext`. Tools never touch a transport.
- `src/context.ts` creates one Statpad client per tool call, with one shared 10-second abort signal, the request counter that stops a fourth request, and the allowance read from the `RateLimit` headers.
- `src/server.ts` registers the tools on an `McpServer` and turns results and errors into tool results. `src/errors.ts` writes the error messages the model reads.
- `src/stdio.ts` is the `npx` entry point. It checks `STATPAD_API_KEY` and serves `createStatpadMcpServer` over stdio. A remote entry, such as a Cloudflare Worker, would pass the same factory to `createMcpHandler` and add nothing else.

Keep a tool within 3 requests and its default result within about 2,000 tokens. The tests check both for every tool. The file `test/__snapshots__/tools-list.json` is the schema contract, so change a tool's description or schema only on purpose. After you review a change, `npx vitest run -u` rewrites the file.

## Tests and fixtures

The tests connect a real MCP client to the server in memory, and a stubbed `fetch` answers from `test/fixtures/`. They never call the network. Most tests speak the 2026-07-28 protocol through `createMcpHandler`, and one connects a 2025-era client through the SDK's in-memory linked pair.

[test/fixtures/README.md](test/fixtures/README.md) says where each fixture came from and how to refresh it. The game files are public Statpad samples. The schedule and team lists come from the examples in the API spec, because Statpad publishes no samples of them.

`npm run check:live` builds the server and runs it over stdio against the real API without a real key. It confirms that a malformed key stops the server at startup, and that a well-formed key Statpad never issued gets through initialize and tools/list. It then asks the API directly what it answers for that key, and checks that `list_leagues` maps the same answer. The API should answer 401, which maps to `unauthorized`. Any other answer passes with a warning, because the unauthorized path went untested. It needs the network, so CI doesn't run it.

## The vendored SDK

`@statpad/sdk` isn't on npm yet, so `vendor/statpad-sdk-0.1.0.tgz` holds a copy, and `package.json` depends on it as `file:vendor/statpad-sdk-0.1.0.tgz`. That keeps `npm ci` working in CI. To refresh it, run `npm ci` and `npm pack --pack-destination <this repo>/vendor` in a checkout of statpad-dev/statpad-node, then `npm install` here.

Once the SDK is on npm, drop the copy:

1. Run `npm install @statpad/sdk@^0.1.0`, which rewrites the dependency to `^0.1.0` and updates `package-lock.json`.
2. Delete `vendor/` and this section.
3. Run `npm run check`.

The release workflow runs `npm run check:deps`, which fails while any dependency is a `file:` path, so a release can't ship before this is done.

## Evals

[evals/questions.md](evals/questions.md) holds 33 questions a person might ask an agent, each with the tool calls it should make and what a correct answer must contain or must decline. For some, such as standings and injuries, the right answer is "not available". The tests can't judge an answer, so run the evals by hand before a release that changes a tool, its description or the server instructions:

1. Connect the built server to Claude Code or Claude Desktop with a real key, as shown above.
2. Ask each question in a new conversation, on a day with live games for the live questions.
3. Compare the tool calls and the answer with the entry. Note any miss next to the question.

## Releases

1. Bump `version` in `package.json`, and both `version` fields in `server.json`, to the same value.
2. Merge to `main`.
3. Publish a GitHub release whose tag is that version with a `v` in front, such as `v0.1.0`.

The Release workflow checks the tag against `package.json` and `server.json`, refuses `file:` dependencies, runs `npm run check`, and stages the package with `npm stage publish` through npm trusted publishing. A maintainer then approves the staged version on npmjs.com. After that, publish `server.json` to the MCP Registry with `mcp-publisher login github` and `mcp-publisher publish`. The registry checks that `mcpName` in the published `package.json` matches the name in `server.json`.
