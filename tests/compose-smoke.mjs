import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Run only against this local demonstration. This restarts its containers and
// creates then deletes a dedicated smoke-test student and reservation.
const base = process.env.COMPOSE_URL || 'http://localhost:8080';
const docker = (...args) => execFileSync('docker', ['compose', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
let adminCookie = '';
let studentCookie = '';
let studentId;
let bookingId;
async function call(path, method = 'GET', body, cookie = adminCookie) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), Origin: new URL(base).origin },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return { json, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
}
async function ready() {
  for (let attempt = 0; attempt < 45; attempt++) {
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return; } catch { /* restarting */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Compose stack did not become ready after restart.');
}
try {
  await ready();
  adminCookie = (await call('/auth/login', 'POST', { email: 'admin@uir.ac.ma', password: 'Admin123!' }, '')).cookie;
  assert.ok(adminCookie);
  const email = `compose-smoke-${Date.now()}@uir.ac.ma`;
  const created = await call('/admin/students', 'POST', { name: 'Compose Smoke Student', email, password: 'SmokeTest123!' });
  studentId = created.json.student.id;
  studentCookie = (await call('/auth/login', 'POST', { email, password: 'SmokeTest123!' }, '')).cookie;
  const availability = (await call('/availability')).json;
  assert.equal(availability.slots.length, 60);
  const slot = availability.slots.find(s => s.state === 'available');
  if (slot) {
    bookingId = (await call('/reservations', 'POST', { courtId: slot.courtId, date: slot.date, hour: slot.hour }, studentCookie)).json.reservation.id;
  }
  docker('restart', 'db', 'backend', 'frontend');
  await ready();
  assert.equal((await call('/auth/me', 'GET', undefined, studentCookie)).json.user.id, studentId, 'database session survives restart');
  assert.equal((await call('/auth/me')).json.user.role, 'admin', 'admin session survives restart');
  if (bookingId) {
    const reservations = (await call('/reservations', 'GET', undefined, studentCookie)).json.reservations;
    assert.equal(reservations.find(r => r.id === bookingId)?.status, 'confirmed', 'reservation survives restart');
    await call(`/reservations/${bookingId}`, 'DELETE', undefined, studentCookie);
  }
  console.log(`Compose smoke passed: Nginx proxy, PostgreSQL sessions, student creation, ${bookingId ? 'booking persistence, cancellation, ' : ''}and restart persistence.`);
} finally {
  if (studentId) {
    assert.match(studentId, /^[0-9a-f-]{36}$/i);
    // Delete only records belonging to the UUID created by this test.
    docker('exec', '-T', 'db', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$1"', 'smoke-cleanup',
      `BEGIN; DELETE FROM reservations WHERE student_id='${studentId}'; DELETE FROM session WHERE sess->>'userId'='${studentId}'; DELETE FROM users WHERE id='${studentId}'; COMMIT;`);
  }
}
