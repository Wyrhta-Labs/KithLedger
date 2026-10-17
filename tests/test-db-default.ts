import { readFileSync } from 'node:fs';

// Runs before tests/setup.ts (see vitest.config.ts). setup.ts imports src/db,
// whose env module loads this repo's .env — and that file names the DEV
// database, which the destructive-suite guard then refuses. Exported vars win
// over .env, so filling DATABASE_URL here first points an unexported run at
// the Wyrhta dev stack's disposable test cluster (`db-test`, 15433) instead.
//
// Its `kithledger` role uses the generated KITH_DB_PASSWORD from the meta
// repo's deploy/.env, so a checkout inside the meta repo reads it from there.
// Anywhere else there is no such file and the password falls back to
// `changeme` — export DATABASE_URL to use any other database.
function wyrhtaTestDbPassword(): string | undefined {
  try {
    const env = readFileSync(new URL('../../deploy/.env', import.meta.url), 'utf8');
    const value = /^KITH_DB_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2');
    return value || undefined;
  } catch {
    return undefined;
  }
}

process.env['DATABASE_URL'] ??=
  `postgres://kithledger:${encodeURIComponent(wyrhtaTestDbPassword() ?? 'changeme')}@127.0.0.1:15433/kithledger_test`;
