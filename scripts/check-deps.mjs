import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const local = [];
for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
    if (/^(file|link|portal|workspace):/.test(spec) || spec.startsWith('.') || spec.startsWith('/')) local.push(`${field}.${name}: ${spec}`);
  }
}

if (local.length > 0) {
  console.error('A published package must not depend on local files:');
  for (const entry of local) console.error(`  ${entry}`);
  console.error('Publish the dependency to npm and depend on its version range instead.');
  process.exit(1);
}
console.log('No file: dependencies.');
