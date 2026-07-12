import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { users } from '../src/db/schema/index.js';
import { seedAdmin, getAdminUser, ADMIN_HANDLE } from '../src/identity.js';

describe('seedAdmin', () => {
  it('creates exactly one admin user and is idempotent', async () => {
    await seedAdmin();
    await seedAdmin(); // second call must be a no-op

    const rows = await db.select().from(users).where(eq(users.handle, ADMIN_HANDLE));
    expect(rows.length).toBe(1);
    expect(rows[0]!.role).toBe('admin');

    const admin = await getAdminUser();
    expect(admin.handle).toBe(ADMIN_HANDLE);
  });
});
