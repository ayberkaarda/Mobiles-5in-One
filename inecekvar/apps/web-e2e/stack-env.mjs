// Ports and environment of the local API stack used by the moderation e2e (ADR-0041). The
// database and MinIO passwords are the compose development defaults. The TOTP encryption key is
// created per run in playwright.config.ts and handed to uvicorn only.
export const REAL_STACK = {
  project: 'iv4e',
  apiPort: 57947,
  proxyPort: 57996,
  mailUi: 'http://127.0.0.1:57946',
  composePorts: {
    INECEKVAR_PG_PORT: '57941',
    INECEKVAR_REDIS_PORT: '57942',
    INECEKVAR_MINIO_PORT: '57943',
    INECEKVAR_MINIO_CONSOLE_PORT: '57944',
    INECEKVAR_MAIL_SMTP_PORT: '57945',
    INECEKVAR_MAIL_UI_PORT: '57946',
  },
  apiEnv: {
    INECEKVAR_ENV: 'local',
    INECEKVAR_DATABASE_URL:
      'postgresql+asyncpg://inecekvar:inecekvar_local_dev@127.0.0.1:57941/inecekvar',
    INECEKVAR_REDIS_URL: 'redis://127.0.0.1:57942/0',
    INECEKVAR_SMTP_HOST: '127.0.0.1',
    INECEKVAR_SMTP_PORT: '57945',
    INECEKVAR_S3_ENDPOINT_URL: 'http://127.0.0.1:57943',
    INECEKVAR_HIBP_ENABLED: 'false',
  },
};
