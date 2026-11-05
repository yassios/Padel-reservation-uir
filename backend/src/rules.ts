import { DateTime } from 'luxon';

export const ZONE = 'Africa/Casablanca';
export const nowLocal = () => DateTime.now().setZone(ZONE);

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'VALIDATION_ERROR') { super(message); }
}

export function validateSlot(date: string, hour: number, now = nowLocal(), currentWeekOnly = true) {
  const start = DateTime.fromISO(`${date}T${String(hour).padStart(2, '0')}:00`, { zone: ZONE });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !start.isValid || start.toISODate() !== date)
    throw new HttpError(400, 'Choose a valid date.');
  if (start.weekday > 5 || !Number.isInteger(hour) || hour < 16 || hour > 21)
    throw new HttpError(400, 'Courts open Monday–Friday, 16:00–22:00, in one-hour slots.');
  if (currentWeekOnly && start.startOf('week').toISODate() !== now.startOf('week').toISODate())
    throw new HttpError(400, 'Reservations are available for the current week only.');
  if (start.toMillis() <= now.toMillis())
    throw new HttpError(400, 'Choose a slot that has not started yet.');
  return start;
}

export function assertNotStarted(date: string, hour: number, now = nowLocal()) {
  if (DateTime.fromISO(`${date}T${String(hour).padStart(2, '0')}:00`, { zone: ZONE }).toMillis() <= now.toMillis())
    throw new HttpError(400, 'This reservation has already started.');
}
