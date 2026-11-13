import { readFileSync } from 'node:fs';

const allowed = /^(dist\/.+|README\.md|LICENSE|package\.json)$/;

const output = JSON.parse(readFileSync(0, 'utf8'));
const [pack] = Array.isArray(output) ? output : Object.values(output);
const files = pack.files.map((file) => file.path).sort();
const unexpected = files.filter((path) => !allowed.test(path));
const required = ['dist/index.js', 'dist/index.d.ts', 'dist/stdio.js', 'README.md', 'LICENSE', 'package.json'];
const missing = required.filter((path) => !files.includes(path));

console.log(`${pack.filename}: ${files.length} files, ${pack.size} bytes packed`);
for (const path of files) console.log(`  ${path}`);
if (unexpected.length > 0 || missing.length > 0) {
  if (unexpected.length > 0) console.error(`unexpected files in the tarball: ${unexpected.join(', ')}`);
  if (missing.length > 0) console.error(`missing from the tarball: ${missing.join(', ')}`);
  process.exit(1);
}
