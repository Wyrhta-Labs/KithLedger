import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for HS256 security'),
  ADMIN_PASSWORD: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3000),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  CORS_ORIGIN: z.string().default('*'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  KITHLEDGER_MCP_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  databaseUrl: parsed.data.DATABASE_URL,
  jwtSecret: parsed.data.JWT_SECRET,
  adminPassword: parsed.data.ADMIN_PASSWORD,
  port: parsed.data.API_PORT,
  jwtTtlSeconds: parsed.data.JWT_TTL_SECONDS,
  corsOrigin: parsed.data.CORS_ORIGIN,
  dbPoolMax: parsed.data.DB_POOL_MAX,
  mcpApiKey: parsed.data.KITHLEDGER_MCP_API_KEY,
} as const;
