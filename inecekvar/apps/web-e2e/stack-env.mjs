// Ports and environment of the local API stacks used by the real-API e2e runs (ADR-0041,
// ADR-0052). The database and MinIO passwords are the compose development defaults. The TOTP
// encryption key is created per run in playwright.config.ts and handed to uvicorn only.
//
// IV_E2E_STACK picks the stack: `iv4e` (phase 4 moderation run, the default) or `iv6b` (the
// phase 6 attack and XSS sweep, its own compose project and ports so it can run beside another
// stack). All ports are on 127.0.0.1 and outside 57277-57776.
const STACKS = {
  iv4e: {
    project: 'iv4e',
    apiPort: 57947,
    proxyPort: 57996,
    ssrPort: 57997,
    mailUi: 'http://127.0.0.1:57946',
    composePorts: {
      INECEKVAR_PG_PORT: '57941',
      INECEKVAR_REDIS_PORT: '57942',
      INECEKVAR_MINIO_PORT: '57943',
      INECEKVAR_MINIO_CONSOLE_PORT: '57944',
      INECEKVAR_MAIL_SMTP_PORT: '57945',
      INECEKVAR_MAIL_UI_PORT: '57946',
    },
  },
  iv6b: {
    project: 'iv6b',
    apiPort: 57957,
    proxyPort: 57958,
    ssrPort: 57959,
    mailUi: 'http://127.0.0.1:57956',
    composePorts: {
      INECEKVAR_PG_PORT: '57951',
      INECEKVAR_REDIS_PORT: '57952',
      INECEKVAR_MINIO_PORT: '57953',
      INECEKVAR_MINIO_CONSOLE_PORT: '57954',
      INECEKVAR_MAIL_SMTP_PORT: '57955',
      INECEKVAR_MAIL_UI_PORT: '57956',
    },
  },
};

const name = process.env.IV_E2E_STACK ?? 'iv4e';
const stack = STACKS[name];
if (!stack) throw new Error(`unknown IV_E2E_STACK ${name}`);
const ports = stack.composePorts;

export const REAL_STACK = {
  ...stack,
  apiEnv: {
    INECEKVAR_ENV: 'local',
    INECEKVAR_DATABASE_URL: `postgresql+asyncpg://inecekvar:inecekvar_local_dev@127.0.0.1:${ports.INECEKVAR_PG_PORT}/inecekvar`,
    INECEKVAR_REDIS_URL: `redis://127.0.0.1:${ports.INECEKVAR_REDIS_PORT}/0`,
    INECEKVAR_SMTP_HOST: '127.0.0.1',
    INECEKVAR_SMTP_PORT: ports.INECEKVAR_MAIL_SMTP_PORT,
    INECEKVAR_S3_ENDPOINT_URL: `http://127.0.0.1:${ports.INECEKVAR_MINIO_PORT}`,
    INECEKVAR_HIBP_ENABLED: 'false',
  },
};
