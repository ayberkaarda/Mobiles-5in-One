import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is used only to generate SQL migration files from the schema (`db:generate`) and to
 * check their consistency (`db:check`). Migrations are applied with `db:migrate`, which reads the
 * connection URL through @kadro/config, so no credentials are configured here.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
