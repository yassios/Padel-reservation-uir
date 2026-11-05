import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';

// This deliberately replaces this demo's pods. It owns its port-forward and
// cleans up only records belonging to its newly created student UUID.
const context = process.env.KUBE_CONTEXT || 'kind-learning';
const namespace = 'mini-projet';
const kubectlArgs = ['--context', context, '-n', namespace];
const kube = (...args) => execFileSync('kubectl', [...kubectlArgs, ...args], {
  encoding: 'utf8', timeout: 240_000, stdio: ['pipe', 'pipe', 'pipe'],
});
let forward;
let base;
let studentId;
let bookingId;
let adminCookie = '';
let studentCookie = '';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function stopForward() {
  if (forward && forward.exitCode === null && forward.signalCode === null) {
    const exited = once(forward, 'exit');
    forward.kill('SIGTERM');
    await exited;
  }
  forward = undefined;
}

async function startForward() {
  await stopForward();
  // Let kubectl select a free local port, avoiding existing Compose/forward ports.
  forward = spawn('kubectl', [...kubectlArgs, 'port-forward', '--address=127.0.0.1', 'service/frontend', ':80'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Port-forward timed out: ${output}`)), 30_000);
    const finish = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
    forward.once('error', finish);
    forward.once('exit', code => finish(new Error(`Port-forward exited (${code}): ${output}`)));
    const read = chunk => {
      output += chunk.toString();
      const match = output.match(/Forwarding from 127\.0\.0\.1:(\d+)/);
      if (match) { base = `http://127.0.0.1:${match[1]}`; finish(); }
    };
    forward.stdout.on('data', read);
    forward.stderr.on('data', read);
  });
}

async function ready() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch { /* Kubernetes may still be replacing service endpoints. */ }
    await delay(1000);
  }
  throw new Error('Kubernetes application did not become ready.');
}

async function call(path, method = 'GET', body, cookie = adminCookie) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), Origin: new URL(base).origin },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return { json, cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
}

try {
  assert.equal(kube('get', 'pvc', 'postgres-data', '-o', 'jsonpath={.status.phase}'), 'Bound');
  await startForward();
  await ready();
  for (const path of ['/', '/reservations']) {
    const page = await fetch(`${base}${path}`);
    assert.ok(page.ok, `frontend serves ${path}`);
    assert.match(await page.text(), /<div id="root">/, 'SPA HTML is served');
  }
  adminCookie = (await call('/auth/login', 'POST', { email: 'admin@uir.ac.ma', password: 'Admin123!' }, '')).cookie;
  assert.ok(adminCookie);
  const email = `k8s-smoke-${Date.now()}@uir.ac.ma`;
  studentId = (await call('/admin/students', 'POST', { name: 'Kubernetes Smoke Student', email, password: 'SmokeTest123!' })).json.student.id;
  studentCookie = (await call('/auth/login', 'POST', { email, password: 'SmokeTest123!' }, '')).cookie;
  assert.ok(studentCookie);
  const availability = (await call('/availability')).json;
  assert.equal(availability.slots.length, 60);
  const slot = availability.slots.find(s => s.state === 'available');
  if (slot) {
    bookingId = (await call('/reservations', 'POST', { courtId: slot.courtId, date: slot.date, hour: slot.hour }, studentCookie)).json.reservation.id;
  }
  const oldDb = kube('get', 'pods', '-l', 'app=db', '-o', 'jsonpath={.items[0].metadata.uid}');
  await stopForward();
  kube('rollout', 'restart', 'deployment/db', 'deployment/backend', 'deployment/frontend');
  for (const name of ['db', 'backend', 'frontend']) {
    process.stdout.write(kube('rollout', 'status', `deployment/${name}`, '--timeout=180s'));
  }
  assert.notEqual(kube('get', 'pods', '-l', 'app=db', '-o', 'jsonpath={.items[0].metadata.uid}'), oldDb, 'database pod was replaced');
  await startForward();
  await ready();
  assert.equal((await call('/auth/me', 'GET', undefined, studentCookie)).json.user.id, studentId, 'student and database session survive pod replacement');
  assert.equal((await call('/auth/me')).json.user.role, 'admin', 'admin session survives pod replacement');
  if (bookingId) {
    const reservations = (await call('/reservations', 'GET', undefined, studentCookie)).json.reservations;
    assert.equal(reservations.find(r => r.id === bookingId)?.status, 'confirmed', 'reservation persists');
    await call(`/reservations/${bookingId}`, 'DELETE', undefined, studentCookie);
  }
  console.log(`Kubernetes smoke passed: frontend, SPA routing, API proxy, login, PVC, account/session persistence${bookingId ? ', booking persistence and cancellation' : ' (booking skipped: no available slot)'}.`);
} finally {
  try {
    if (studentId) {
      assert.match(studentId, /^[0-9a-f-]{36}$/i);
      kube('exec', 'deployment/db', '--', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$1"', 'smoke-cleanup',
        `BEGIN; DELETE FROM reservations WHERE student_id='${studentId}'; DELETE FROM session WHERE sess->>'userId'='${studentId}'; DELETE FROM users WHERE id='${studentId}'; COMMIT;`);
    }
  } finally {
    await stopForward();
  }
}
