import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  WEB_ORIGIN: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  HTTP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(240),
  HTTP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  SOCKET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  SOCKET_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(32_768),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(10_000),
  ROOM_MINIMUM_PLAYER_GRACE_MS: z.coerce.number().int().positive().default(15_000),
  POKER_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  PLAYER_RECONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(details)}`);
  }

  return result.data;
}
