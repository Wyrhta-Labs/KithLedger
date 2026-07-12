import { describe, it, expect, beforeEach } from 'vitest';
import { kithTools } from '../src/mcp/registry.js';
import { createMcpAuthAdapter } from '../src/mcp/auth.js';
import { seedAdmin, identity, getAdminUser } from '../src/identity.js';

const EXPECTED_TOOL_NAMES = [
  'kith.complete_reminder',
  'kith.create_person',
  'kith.create_reminder',
  'kith.create_relationship',
  'kith.get_person',
  'kith.get_person_graph',
  'kith.list_interactions',
  'kith.list_people',
  'kith.list_reminders',
  'kith.list_relationships',
  'kith.log_interaction',
  'kith.snooze_reminder',
  'kith.update_person',
].sort();

describe('kithTools registry', () => {
  beforeEach(async () => {
    await seedAdmin();
  });

  it('has exactly the expected 13 tool names', () => {
    const names = kithTools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('every tool name starts with kith. and names are unique', () => {
    const names = kithTools.map((t) => t.name);
    expect(names.length).toBe(13);
    for (const name of names) {
      expect(name.startsWith('kith.')).toBe(true);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it('auth adapter resolves a valid api key, rejects garbage/empty', async () => {
    const admin = await getAdminUser();
    const key = await identity.createApiKey(admin.id, 'mcp-e2e');

    await expect(createMcpAuthAdapter(() => key.key).resolve()).resolves.not.toBeNull();
    await expect(createMcpAuthAdapter(() => 'kl_not-a-real-key').resolve()).rejects.toThrow();
    await expect(createMcpAuthAdapter(() => '').resolve()).rejects.toThrow();
  });
});
