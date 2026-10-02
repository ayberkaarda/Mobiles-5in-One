// Runs in a separate Node process (see connection-loss.test.ts). It opens a transaction through
// `createDbClient`, then reports what happens when the server kills the connection mid-query.
import { register } from 'node:module';

// The sources are TypeScript with `.js` import specifiers; map them back to the `.ts` files.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
    const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(candidate))) {
      return next(candidate.href, context);
    }
  }
  return next(specifier, context);
}
`),
);

const { createDbClient } = await import(new URL('../../src/client.ts', import.meta.url).href);
const { sql } = await import('drizzle-orm');

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const client = createDbClient({
  connectionString: process.argv[2],
  maxConnections: 2,
  onClientError: (error) => emit({ event: 'client-error-logged', code: error.code ?? null }),
});

try {
  await client.db.transaction(async (tx) => {
    const result = await tx.execute(sql`select pg_backend_pid() as pid`);
    emit({ event: 'pid', pid: result.rows[0].pid });
    await tx.execute(sql`select pg_sleep(60)`);
  });
  emit({ event: 'unexpected-success' });
} catch (error) {
  emit({
    event: 'rejected',
    name: error?.name ?? null,
    code: error?.code ?? error?.cause?.code ?? null,
  });
}

const after = await client.db.execute(sql`select 1 as ok`);
emit({ event: 'recovered', ok: after.rows[0].ok });
await client.close();
