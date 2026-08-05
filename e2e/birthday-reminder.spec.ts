import { test, expect, FIXTURE_PREFIX, birthdayInDays } from './fixtures.js';

/**
 * The Add Person modal's birthday-reminder offer, end to end: the conditional
 * UI, and what the browser actually sends to the API.
 */
test.describe('Add Person — birthday reminder', () => {
  test('is offered only once a birthday is set, and only when creating', async ({ loggedIn: page }) => {
    const birthday = birthdayInDays(12);

    await page.goto('/people');
    await page.getByRole('button', { name: /add person/i }).first().click();
    await expect(page.locator('#name')).toBeVisible();

    await expect(page.locator('#createBirthdayReminder')).toHaveCount(0);

    await page.fill('#name', `${FIXTURE_PREFIX}Conditional`);
    await page.fill('#birthday', birthday);
    await expect(page.locator('#createBirthdayReminder')).toBeVisible();
    await expect(page.locator('#createBirthdayReminder')).toBeChecked();

    // Clearing the birthday withdraws the offer entirely.
    await page.fill('#birthday', '');
    await expect(page.locator('#createBirthdayReminder')).toHaveCount(0);
    await page.fill('#birthday', birthday);
    await expect(page.locator('#createBirthdayReminder')).toBeVisible();

    // Unchecking hides the lead-time select but keeps the checkbox.
    await page.uncheck('#createBirthdayReminder');
    await expect(page.locator('#birthdayReminderLeadDays')).toHaveCount(0);
    await page.check('#createBirthdayReminder');
    await expect(page.locator('#birthdayReminderLeadDays')).toBeVisible();

    const leadSelect = page.locator('#birthdayReminderLeadDays');
    await expect(leadSelect.locator('option')).toHaveCount(4);
    await expect(leadSelect).toHaveValue('0');
  });

  test('creates a yearly reminder with the chosen lead time', async ({ loggedIn: page, api }) => {
    const name = `${FIXTURE_PREFIX}Lead Seven`;
    const birthday = birthdayInDays(12);
    const [, month, day] = birthday.split('-');

    await page.goto('/people');
    await page.getByRole('button', { name: /add person/i }).first().click();
    await page.fill('#name', name);
    await page.fill('#birthday', birthday);
    await expect(page.locator('#createBirthdayReminder')).toBeChecked();
    await page.selectOption('#birthdayReminderLeadDays', '7');
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.locator('#name')).toBeHidden();

    const people = await api.get(`/people?q=${encodeURIComponent(name)}`);
    expect(people.data).toHaveLength(1);
    const person = people.data[0];
    api.trackPerson(person.id);
    expect(person.birthday).toBe(birthday);

    const reminders = await api.get(`/reminders?person_id=${person.id}&kind=birthday`);
    expect(reminders.data).toHaveLength(1);
    const reminder = reminders.data[0];
    expect(reminder.kind).toBe('birthday');
    expect(reminder.leadDays).toBe(7);
    expect(reminder.recurrence).toBe('P1Y');
    expect(reminder.title).toBe(`Birthday: ${name}`);

    // Due seven days before the birthday, at 09:00 in the browser's timezone.
    const due = new Date(reminder.dueAt);
    expect(due.getHours()).toBe(9);
    expect(due.getMinutes()).toBe(0);
    const birthdayFromDue = new Date(due.getTime() + 7 * 86_400_000);
    expect(String(birthdayFromDue.getMonth() + 1).padStart(2, '0')).toBe(month);
    expect(String(birthdayFromDue.getDate()).padStart(2, '0')).toBe(day);
  });

  test('creates no reminder when the box is unchecked', async ({ loggedIn: page, api }) => {
    const name = `${FIXTURE_PREFIX}Opted Out`;

    await page.goto('/people');
    await page.getByRole('button', { name: /add person/i }).first().click();
    await page.fill('#name', name);
    await page.fill('#birthday', birthdayInDays(12));
    await page.uncheck('#createBirthdayReminder');
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.locator('#name')).toBeHidden();

    const people = await api.get(`/people?q=${encodeURIComponent(name)}`);
    const person = people.data[0];
    api.trackPerson(person.id);

    const reminders = await api.get(`/reminders?person_id=${person.id}&kind=birthday`);
    expect(reminders.data).toHaveLength(0);
  });

  test('does not offer the reminder when editing an existing person', async ({ loggedIn: page, api }) => {
    const name = `${FIXTURE_PREFIX}Editable`;
    const birthday = birthdayInDays(20);
    await api.post('/people', { name, birthday });

    await page.goto('/people');
    await page.locator('tr', { hasText: name }).locator('button').first().click();
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#birthday')).toHaveValue(birthday);
    await expect(page.locator('#createBirthdayReminder')).toHaveCount(0);
  });
});
