import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://kith:changeme-local-dev@localhost:5432/kithledger',
      JWT_SECRET: process.env.JWT_SECRET ?? 'a'.repeat(32),
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'Test!ng1234Secure',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    },
  },
});
