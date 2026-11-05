import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T10:00:00Z'));
});

test('student booking, rescheduling, cancellation, and logout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Student', exact: true }).click();
  await page.getByRole('button', { name: 'Step onto the court' }).click();
  await expect(page.getByRole('heading', { name: /Your next match/ })).toBeVisible();
  await expect(page.getByText('24 open slots')).toBeVisible();
  const slots = page.locator('button.slot.available:not([disabled])');
    await slots.first().click();
    await page.getByRole('button', { name: 'Confirm reservation' }).click();
    await expect(page.getByRole('status')).toContainText('Court booked');
    await page.getByRole('button', { name: 'My reservations', exact: true }).click();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
    await page.getByRole('button', { name: /Court 2/ }).first().click();
    const next = page.locator('button.slot.available:not([disabled])');
      await next.first().click();
      await page.getByRole('button', { name: 'Confirm new time' }).click();
      await expect(page.getByRole('status')).toContainText('rescheduled');
    await page.getByRole('button', { name: 'My reservations', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Good to see you.' })).toBeVisible();
});

test('administrator creates, edits, deactivates students and manages closures', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrator', exact: true }).click();
  await page.getByRole('button', { name: 'Step onto the court' }).click();
  await page.getByRole('button', { name: 'Students', exact: true }).click();
  await page.getByRole('button', { name: 'Add student', exact: true }).click();
  await page.getByLabel('Full name').fill('Browser Student');
  await page.getByLabel('Email', { exact: true }).fill('browser@uir.ac.ma');
  await page.getByLabel('Password', { exact: true }).fill('Browser123!');
  await page.getByRole('button', { name: 'Create student account' }).click();
  const row = page.getByRole('row').filter({ hasText: 'browser@uir.ac.ma' });
  await expect(row).toContainText('Active');
  await row.getByRole('button', { name: 'Edit student' }).click();
  await page.getByLabel('Full name').fill('Updated Browser Student');
  await page.getByLabel('Account active').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(row).toContainText('Inactive');
  await expect(row).toContainText('Updated Browser Student');
  await page.getByRole('button', { name: 'Court closures', exact: true }).click();
  await page.getByRole('button', { name: 'Add closure', exact: true }).click();
  await page.getByLabel('Date', { exact: true }).fill('2026-11-09');
  await page.getByLabel('Reason').fill('Browser test maintenance');
  await page.getByRole('button', { name: 'Add closure', exact: true }).last().click();
  await expect(page.getByRole('cell', { name: 'Browser test maintenance' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove closure', exact: true }).click();
  await page.getByRole('button', { name: 'Remove closure', exact: true }).last().click();
  await expect(page.getByText('All clear on the courts.')).toBeVisible();
});

test('mobile layout keeps navigation and the booking grid usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Student', exact: true }).click();
  await page.getByRole('button', { name: 'Step onto the court' }).click();
  await expect(page.getByRole('heading', { name: 'Pick your court.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Court 2/ }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/mobile-courts.png', fullPage: true });
});
