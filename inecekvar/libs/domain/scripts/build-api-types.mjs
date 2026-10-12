// Builds libs/domain/src/lib/api.ts from docs/api/openapi.json (the contract FastAPI emits with
// `uv run python -m app.contract` in api/). Types only: no runtime code is produced.
// Usage: node libs/domain/scripts/build-api-types.mjs          writes the file
//        node libs/domain/scripts/build-api-types.mjs --check  exits 1 when the file is stale
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { format, resolveConfig } from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const contractPath = join(root, 'docs', 'api', 'openapi.json');
const outputPath = join(root, 'libs', 'domain', 'src', 'lib', 'api.ts');

const HEADER = [
  '// API types derived from docs/api/openapi.json by libs/domain/scripts/build-api-types.mjs.',
  '// Do not edit by hand: change the API, write the contract, then run the script.',
  '',
].join('\n');

export async function buildTypes() {
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  const ast = await openapiTS(contract, { alphabetize: true, exportType: true });
  const source = HEADER + astToString(ast);
  const options = (await resolveConfig(outputPath)) ?? {};
  return format(source, { ...options, filepath: outputPath });
}

const expected = await buildTypes();
if (process.argv.includes('--check')) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  if (current !== expected) {
    console.error(
      'libs/domain/src/lib/api.ts is stale: run node libs/domain/scripts/build-api-types.mjs',
    );
    process.exit(1);
  }
  console.log('libs/domain/src/lib/api.ts matches docs/api/openapi.json');
} else {
  writeFileSync(outputPath, expected);
  console.log('Wrote libs/domain/src/lib/api.ts');
}
