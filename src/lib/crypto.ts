import { createHash, randomBytes } from 'crypto';

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const bytes = randomBytes(32).toString('hex');
  const raw = `kl_${bytes}`;
  const hash = hashKey(raw);
  const prefix = raw.slice(0, 11); // 'kl_' + 8 chars
  return { raw, hash, prefix };
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
