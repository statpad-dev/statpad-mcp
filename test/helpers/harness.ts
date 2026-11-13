import { Client, InMemoryTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';

import type { Logger } from '../../src/log.js';
import { estimateTokens } from '../../src/output.js';
import { createStatpadMcpServer } from '../../src/server.js';
import { createStub, type Stub, type StubOptions, TEST_KEY } from './stub.js';

export interface Harness {
  client: Client;
  stub: Stub;
  logs: string[];
  call(name: string, args?: Record<string, unknown>): Promise<CallOutcome>;
  close(): Promise<void>;
}

export interface CallOutcome {
  isError: boolean;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  structured: unknown;
  tokens: number;
  /** Requests the stub received during this call. */
  requests: Request[];
}

export interface HarnessOptions extends StubOptions {
  now?: Date;
  era?: 'modern' | 'legacy';
  timeoutMs?: number;
}

/**
 * Connects a real MCP client to the server in memory. The default modern era goes through
 * createMcpHandler's fetch, the SDK's in-process path for the 2026-07-28 protocol. The legacy
 * era uses InMemoryTransport's linked pair, which speaks the 2025 initialize handshake.
 */
export async function connect(options: HarnessOptions = {}): Promise<Harness> {
  const stub = createStub(options);
  const logs: string[] = [];
  const logger: Logger = (level, message, fields) => logs.push(JSON.stringify({ level, message, ...fields }));
  const factory = () =>
    createStatpadMcpServer({
      apiKey: TEST_KEY,
      fetch: stub.fetch,
      now: () => options.now ?? new Date('2026-11-12T17:00:00Z'),
      logger,
      timeoutMs: options.timeoutMs,
    });

  const client = new Client({ name: 'statpad-mcp-tests', version: '1.0.0' }, options.era === 'legacy' ? {} : { versionNegotiation: { mode: 'auto' } });
  let closeServer: () => Promise<void>;
  if (options.era === 'legacy') {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = factory();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeServer = () => server.close();
  } else {
    const handler = createMcpHandler(factory);
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
        fetch: (url, init) => handler.fetch(new Request(url, init)),
      }),
    );
    closeServer = () => handler.close();
  }

  return {
    client,
    stub,
    logs,
    async call(name, args = {}) {
      const before = stub.requests.length;
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text: string }[];
      const text = content[0]?.text ?? '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      return {
        isError: result.isError === true,
        text,
        json: parsed,
        structured: result.structuredContent,
        tokens: estimateTokens(parsed ?? text),
        requests: stub.requests.slice(before),
      };
    },
    async close() {
      await client.close();
      await closeServer();
    },
  };
}
