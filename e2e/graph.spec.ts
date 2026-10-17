import { test, expect, FIXTURE_PREFIX } from './fixtures.js';

test.describe('Graph explorer', () => {
  // The canvas used to take the window's width rather than its card's, so it
  // overflowed the card (clipped) and centred the graph on the window: beside
  // the sidebar, the whole cluster sat right of the card's centre.
  test('draws the graph canvas exactly as wide as its card', async ({ loggedIn: page, api }) => {
    const from = `${FIXTURE_PREFIX}Graph From`;
    const { data: a } = await api.post('/people', { name: from });
    const { data: b } = await api.post('/people', { name: `${FIXTURE_PREFIX}Graph To` });
    await api.post('/relationships', { fromPersonId: a.id, toPersonId: b.id, type: 'friend' });

    await page.goto('/graph');
    await page.getByPlaceholder('Search for a person…').fill('Graph From');
    // The person picker only appears once the search has results.
    await page.locator('select', { has: page.locator(`option[value="${a.id}"]`) }).selectOption(a.id);

    const card = page.getByTestId('graph-card');
    const canvas = card.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // The card's 1px border on each side.
    const gap = async () => {
      const [c, k] = await Promise.all([canvas.boundingBox(), card.boundingBox()]);
      return c && k ? Math.round(k.width - c.width) : null;
    };
    await expect.poll(gap).toBe(2);

    // And it follows the card when the window changes — here across the
    // width at which the sidebar collapses.
    await page.setViewportSize({ width: 900, height: 800 });
    await expect.poll(gap).toBe(2);
  });
});
