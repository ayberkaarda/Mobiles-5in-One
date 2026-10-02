import { mkdirSync, writeFileSync } from 'node:fs';

import { buildOpenApiDocument, serializeOpenApiDocument } from '../src/openapi.js';

/**
 * Writes `docs/api/openapi.json` from the endpoint registry. Run with
 * `pnpm --filter @kadro/contracts openapi`; `src/openapi.test.ts` fails while the committed file
 * differs from what this script would write.
 */
const outputDirectory = `${import.meta.dirname}/../../../docs/api`;

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(`${outputDirectory}/openapi.json`, serializeOpenApiDocument(buildOpenApiDocument()));
