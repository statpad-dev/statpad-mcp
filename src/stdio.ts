#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { isWellFormedApiKey } from './key.js';
import { stderrLogger } from './log.js';
import { createStatpadMcpServer } from './server.js';
import { VERSION } from './version.js';

const apiKey = process.env.STATPAD_API_KEY?.trim() ?? '';

if (apiKey === '') {
  console.error(
    'statpad-mcp: STATPAD_API_KEY is not set. Create a key on the Keys page at https://app.statpad.dev and set it in the environment of this MCP server.',
  );
  process.exit(1);
}

if (!isWellFormedApiKey(apiKey)) {
  console.error(
    "statpad-mcp: STATPAD_API_KEY isn't a Statpad API key. A key starts with sporty_ and is 67 characters long. Copy the whole key from the Keys page at https://app.statpad.dev, with nothing before or after it.",
  );
  process.exit(1);
}

const logger = stderrLogger(process.env.STATPAD_MCP_LOG);

serveStdio(
  () =>
    createStatpadMcpServer({
      apiKey,
      baseUrl: process.env.STATPAD_BASE_URL || undefined,
      logger,
      transport: 'stdio',
    }),
  { onerror: (error) => logger('error', 'transport error', { error: error.message }) },
);

logger('info', `statpad-mcp ${VERSION} is serving on stdio`);
