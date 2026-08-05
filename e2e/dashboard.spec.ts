import { test, expect, FIXTURE_PREFIX, birthdayInDays } from './fixtures.js';

/**
 * Anchored on a data-testid rather than the card's heading text: filtering divs
 * by `hasText` matches the innermost one, which is the title element itself, so
 * the assertions passed vacuously against a node that never contains any names.
 */
const birthdayWidget = (page: import('@playwright/test').Page) =>
  page.getByTestId('birthday-widget');

test.describe('Dashboard', () => {
  test('the birthday widget defers to active birthday reminders', async ({ loggedIn: page, api }) => {
    const tracked = `${FIXTURE_PREFIX}Tracked`;
    const untracked = `${FIXTURE_PREFIX}Untracked`;
    const birthday = birthdayInDays(10);

    const { data: trackedPerson } = await api.post('/people', { name: tracked, birthday });
    await api.post('/people', { name: untracked, birthday: birthdayInDays(11, 1985) });

    const { data: reminder } = await api.post('/reminders', {
      personId: trackedPerson.id,
      dueAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
      title: `Birthday: ${tracked}`,
      recurrence: 'P1Y',
      kind: 'birthday',
      leadDays: 1,
    });

    await page.goto('/');
    await expect(birthdayWidget(page)).toContainText(untracked);
    await expect(birthdayWidget(page)).not.toContainText(tracked);

    // Dismissing the only active reminder must surface the birthday again — a
    // done/dismissed reminder should never hide a birthday permanently.
    await api.post(`/reminders/${reminder.id}/dismiss`);
    await page.reload();
    await expect(birthdayWidget(page)).toContainText(tracked);
  });

  test('every stat card renders a number, not an em dash', async ({ loggedIn: page, api }) => {
    // Guards two bugs: the interactions stat sent a local-offset timestamp the
    // API rejected, and the relationships stat was hardcoded to an em dash.
    const a = await api.post('/people', { name: `${FIXTURE_PREFIX}Stat A` });
    const b = await api.post('/people', { name: `${FIXTURE_PREFIX}Stat B` });
    await api.post('/relationships', {
      fromPersonId: a.data.id,
      toPersonId: b.data.id,
      type: 'friend',
    });
    await api.post('/interactions', {
      personId: a.data.id,
      occurredAt: new Date().toISOString(),
      type: 'call',
    });

    const failed: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });

    await page.goto('/');
    for (const label of ['Total People', 'Interactions This Month', 'Pending Reminders', 'Relationships']) {
      const card = page.locator('div').filter({ hasText: new RegExp(`^\\d+${label}$`) }).last();
      await expect(card, `"${label}" should show a count`).toBeVisible();
    }
    expect(failed, 'dashboard should issue no failing requests').toEqual([]);
  });
});
