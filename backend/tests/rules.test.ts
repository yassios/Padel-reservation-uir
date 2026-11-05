import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { validateSlot, assertNotStarted, ZONE } from '../src/rules.js';

const thursday = DateTime.fromISO('2026-11-05T12:00', { zone: ZONE });
test('weekday hourly slots at the opening and last start time are valid', () => {
  assert.equal(validateSlot('2026-11-05', 16, thursday).hour, 16);
  assert.equal(validateSlot('2026-11-06', 21, thursday).hour, 21);
});
test('reject weekends, out-of-hours, malformed dates, past slots and next week', () => {
  for (const [date, hour] of [['2026-11-07', 16], ['2026-11-08', 16], ['2026-11-05', 15], ['2026-11-05', 22], ['2026-02-30', 16], ['bad-date', 16], ['2026-11-04', 16], ['2026-11-09', 16]] as const)
    assert.throws(() => validateSlot(date, hour, thursday));
});
test('start time itself is too late for booking or student changes', () => {
  const now = DateTime.fromISO('2026-11-05T16:00', { zone: ZONE });
  assert.throws(() => validateSlot('2026-11-05', 16, now));
  assert.throws(() => assertNotStarted('2026-11-05', 16, now));
  assert.doesNotThrow(() => assertNotStarted('2026-11-05', 17, now));
});
test('current-week boundary follows Casablanca even when UTC is still Sunday', () => {
  const now = DateTime.fromISO('2026-11-08T23:30:00Z').setZone(ZONE);
  assert.equal(now.weekday, 1);
  assert.doesNotThrow(() => validateSlot('2026-11-09', 16, now));
  assert.throws(() => validateSlot('2026-11-06', 16, now));
});
test('Morocco timezone follows its seasonal offset changes', () => {
  assert.equal(DateTime.fromISO('2026-02-20T16:00', { zone: ZONE }).offset, 0);
  assert.equal(DateTime.fromISO('2026-11-05T16:00', { zone: ZONE }).offset, 60);
});
