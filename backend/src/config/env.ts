import 'dotenv/config';
import { z } from 'zod';

/**
 * Centralised, validated environment configuration.
 * The app refuses to boot if required secrets are missing — fail fast, not at runtime.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string().optional(),
  PGHOST: z.string().default('localhost'),
  PGPORT: z.coerce.number().default(5432),
  PGUSER: z.string().default('postgres'),
  PGPASSWORD: z.string().default('postgres'),
  PGDATABASE: z.string().default('jssf'),
  PG_POOL_MAX: z.coerce.number().default(10),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  JWT_REFRESH_TTL_REMEMBER: z.string().default('30d'),

  MAX_LOGIN_ATTEMPTS: z.coerce.number().default(5),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  COOKIE_DOMAIN: z.string().default(''),
  COOKIE_SECURE: z.coerce.boolean().default(false),

  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(5),

  SEED_ADMIN_EMAIL: z.string().email().default('admin@jssf.local'),
  SEED_ADMIN_MOBILE: z.string().default('9999999999'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@123'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
