import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';

import { createStatpadMcpServer } from '../src/server.js';
import { TEST_KEY } from './helpers/stub.js';

const gc = (globalThis as { gc?: () => void }).gc;

let api: Server | undefined;
afterEach(async () => {
  api?.closeAllConnections();
  await new Promise((resolve) => api?.close(resolve));
  api = undefined;
});

describe('a Statpad API that accepts the connection and never answers', () => {
  it.runIf(gc)('ends the call with a timeout error, even after a garbage collection', async () => {
    api = createServer(() => {});
    await new Promise<void>((resolve) => api!.listen(0, '127.0.0.1', resolve));
    const { port } = api.address() as AddressInfo;

    const server = createStatpadMcpServer({ apiKey: TEST_KEY, baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 500 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'statpad-mcp-tests', version: '1.0.0' });
    await client.connect(clientTransport);

    const collect = setInterval(() => gc!(), 20);
    try {
      const started = Date.now();
      const result = await client.callTool({ name: 'list_leagues', arguments: {} }, { timeout: 5_000 });
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(result.isError).toBe(true);
      const body = JSON.parse((result.content as { text: string }[])[0]!.text) as { error: string };
      expect(body.error).toBe('timeout');
    } finally {
      clearInterval(collect);
      await client.close();
      await server.close();
    }
  }, 10_000);
});
