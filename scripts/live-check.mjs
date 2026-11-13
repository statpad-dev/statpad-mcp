// Checks the built server against the live API over stdio, with no real key.
//
// 1. A malformed key must stop the server at startup, before it sends anything.
// 2. A well-formed key that Statpad never issued passes the startup check, so the server
//    starts, answers initialize and tools/list, and sends list_leagues to api.statpad.dev.
//    The script first asks the API directly what it answers for that key. The API should
//    answer 401, and the tool must map whatever it answers to the same error code. The
//    check warns when the answer isn't 401, because then the unauthorized path went untested.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const server = fileURLToPath(new URL('../dist/stdio.js', import.meta.url));
const env = { ...process.env, STATPAD_MCP_LOG: 'info' };
delete env.STATPAD_BASE_URL;

function fail(message) {
  console.error(`check:live failed: ${message}`);
  process.exit(1);
}

console.log('1. Malformed key');
const malformed = spawnSync(process.execPath, [server], { env: { ...env, STATPAD_API_KEY: 'not-a-statpad-key' }, encoding: 'utf8', timeout: 10_000 });
console.log(`   exit code ${malformed.status}`);
console.log(`   stderr: ${malformed.stderr.trim()}`);
if (malformed.status === 0) fail('the server started with a malformed key');
if (!malformed.stderr.includes('STATPAD_API_KEY')) fail('the startup error does not name STATPAD_API_KEY');

const bogusKey = `sporty_${randomBytes(12).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
console.log('2. Well-formed key that Statpad never issued');
const probe = await fetch('https://api.statpad.dev/v1/leagues', {
  headers: { Authorization: `Bearer ${bogusKey}` },
  signal: AbortSignal.timeout(10_000),
});
const expected = (await probe.json().catch(() => ({}))).code ?? `http_${probe.status}`;
console.log(`   the API answers this key directly with ${probe.status} ${expected}`);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...env, STATPAD_API_KEY: bogusKey },
  stderr: 'pipe',
});
const serverLog = [];
transport.stderr?.on('data', (chunk) => serverLog.push(...chunk.toString().trim().split('\n')));

const client = new Client({ name: 'statpad-mcp-live-check', version: '1.0.0' });
await client.connect(transport);
const info = client.getServerVersion();
console.log(`   initialize: ${info?.name} ${info?.version}, protocol era ${client.getProtocolEra?.() ?? 'legacy'}`);

const { tools } = await client.listTools();
console.log(`   tools/list: ${tools.map((tool) => tool.name).join(', ')}`);
if (tools.length !== 6) fail(`expected 6 tools, got ${tools.length}`);

const result = await client.callTool({ name: 'list_leagues', arguments: {} });
const text = result.content?.[0]?.text ?? '';
console.log(`   list_leagues isError=${result.isError === true}`);
console.log(`   ${text}`);
await client.close();

for (const line of serverLog) console.log(`   server stderr: ${line}`);
const outputs = [text, ...serverLog].join('\n');
if (outputs.includes(bogusKey) || outputs.includes(bogusKey.split('.')[1])) fail('the key appeared in the output');

let body;
try {
  body = JSON.parse(text);
} catch {
  fail('list_leagues did not return JSON');
}
if (result.isError !== true || body.error !== expected) fail(`expected the ${expected} mapping, got ${text}`);
if (expected === 'unauthorized') {
  if (!body.message.includes('STATPAD_API_KEY')) fail('the unauthorized message does not name STATPAD_API_KEY');
  console.log('check:live passed');
} else {
  console.log(`check:live passed with a warning: the API answered an unknown key with ${probe.status} ${expected} instead of 401, so the unauthorized mapping went untested live`);
}
