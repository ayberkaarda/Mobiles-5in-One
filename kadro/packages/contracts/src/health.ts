import { z } from 'zod';

/** `GET /api/v1/health` response used by uptime checks. Contains no secrets. */
export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('kadro-web'),
  environment: z.enum(['local', 'preview', 'production']),
  buildSha: z.string().min(1).max(64),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
