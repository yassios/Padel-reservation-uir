import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import session from 'express-session';
import { Settings } from 'luxon';
import { createApp } from '../src/app.js';
import { testDatabase } from './database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
let admin: ReturnType<typeof request.agent>;
let amine: ReturnType<typeof request.agent>;
let sara: ReturnType<typeof request.agent>;
let youssef: ReturnType<typeof request.agent>;
let ids: Record<string, string>;
before(async () => {
  Settings.now = () => 1793872800000; // 2026-11-05 10:00 UTC
  fixture = await testDatabase();
  app = createApp(fixture.db, new session.MemoryStore());
  admin = request.agent(app); amine = request.agent(app); sara = request.agent(app); youssef = request.agent(app);
  for (const [agent, email, password] of [[admin, 'admin@uir.ac.ma', 'Admin123!'], [amine, 'amine@uir.ac.ma', 'Student123!'], [sara, 'sara@uir.ac.ma', 'Student123!'], [youssef, 'youssef@uir.ac.ma', 'Student123!']] as const)
    await agent.post('/api/auth/login').send({ email, password }).expect(200);
  const students = (await admin.get('/api/admin/students').expect(200)).body.students;
  ids = Object.fromEntries(students.map((s: any) => [s.email.split('@')[0], s.id]));
});
after(async () => { Settings.now = () => Date.now(); await fixture?.close(); });

test('authentication, admin authorization, origin protection, and input errors', async () => {
  await request(app).get('/api/reservations').expect(401);
  await request(app).post('/api/auth/login').send({ email: 'amine@uir.ac.ma', password: 'wrong' }).expect(401);
  await amine.get('/api/auth/me').expect(200);
  await amine.get('/api/admin/students').expect(403);
  await amine.post('/api/reservations').set('Origin', 'https://evil.example').send({}).expect(403);
  await amine.post('/api/reservations').send({ courtId: 3, date: 'bad', hour: 16 }).expect(400);
  await amine.post('/api/reservations').send({ courtId: 1, date: '2026-11-07', hour: 16 }).expect(400);
  await amine.post('/api/reservations').send({ courtId: 1, date: '2026-11-09', hour: 16 }).expect(400);
});

test('booking CRUD, weekly limit across courts, ownership, and failed-reschedule rollback', async () => {
  const booking = (await amine.post('/api/reservations').send({ courtId: 1, date: '2026-11-05', hour: 16, studentId: ids.sara }).expect(201)).body.reservation;
  assert.equal(booking.student_id, ids.amine, 'students cannot impersonate another student');
  const limit = await amine.post('/api/reservations').send({ courtId: 2, date: '2026-11-06', hour: 18 }).expect(409);
  assert.equal(limit.body.code, 'WEEKLY_LIMIT');
  const other = (await sara.post('/api/reservations').send({ courtId: 2, date: '2026-11-05', hour: 17 }).expect(201)).body.reservation;
  await sara.delete(`/api/reservations/${booking.id}`).expect(403);
  await sara.patch(`/api/reservations/${booking.id}`).send({ courtId: 1, date: '2026-11-06', hour: 18 }).expect(403);
  await amine.patch(`/api/reservations/${booking.id}`).send({ courtId: 2, date: '2026-11-05', hour: 17 }).expect(409);
  const occupied = await fixture.db.query('SELECT * FROM court_slots WHERE reservation_id=$1', [booking.id]);
  assert.equal(occupied.rows[0].court_id, 1); assert.equal(occupied.rows[0].hour, 16);
  await amine.patch(`/api/reservations/${booking.id}`).send({ courtId: 1, date: '2026-11-06', hour: 18 }).expect(200);
  await amine.delete(`/api/reservations/${booking.id}`).expect(204);
  const replacement = await amine.post('/api/reservations').send({ courtId: 1, date: '2026-11-05', hour: 16 }).expect(201);
  const history = (await amine.get('/api/reservations').expect(200)).body.reservations;
  assert.equal(history.length, 2); assert.equal(history.filter((r: any) => r.status === 'cancelled').length, 1);
  await amine.delete(`/api/reservations/${replacement.body.reservation.id}`).expect(204);
  await sara.delete(`/api/reservations/${other.id}`).expect(204);
});

test('closures reject overlapping bookings and rollback a partially allocated range', async () => {
  const booking = (await amine.post('/api/reservations').send({ courtId: 1, date: '2026-11-05', hour: 18 }).expect(201)).body.reservation;
  const data = { courtId: 1, date: '2026-11-05', startHour: 17, endHour: 20, reason: 'Maintenance' };
  await admin.post('/api/admin/closures').send(data).expect(409);
  assert.equal((await fixture.db.query('SELECT * FROM closures')).rowCount, 0);
  assert.equal((await fixture.db.query('SELECT * FROM court_slots WHERE hour=17')).rowCount, 0);
  await admin.delete(`/api/reservations/${booking.id}`).expect(204);
  const closure = (await admin.post('/api/admin/closures').send(data).expect(201)).body.closure;
  const conflict = await amine.post('/api/reservations').send({ courtId: 1, date: '2026-11-05', hour: 18 }).expect(409);
  assert.equal(conflict.body.code, 'SLOT_CONFLICT');
  const availability = (await amine.get('/api/availability').expect(200)).body;
  assert.equal(availability.slots.length, 60);
  assert.equal(availability.slots.filter((s: any) => s.state === 'closed').length, 3);
  await admin.delete(`/api/admin/closures/${closure.id}`).expect(204);
  assert.equal((await fixture.db.query('SELECT * FROM court_slots WHERE closure_id=$1', [closure.id])).rowCount, 0);
});

test('student CRUD, duplicate emails, active-session revocation, history, reactivation', async () => {
  const student = (await admin.post('/api/admin/students').send({ name: 'New Student', email: 'new@uir.ac.ma', password: 'Password123!' }).expect(201)).body.student;
  await admin.post('/api/admin/students').send({ name: 'Duplicate', email: 'new@uir.ac.ma', password: 'Password123!' }).expect(409);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'new@uir.ac.ma', password: 'Password123!' }).expect(200);
  const booking = (await agent.post('/api/reservations').send({ courtId: 2, date: '2026-11-06', hour: 18 }).expect(201)).body.reservation;
  const patch = { name: 'Updated Student', email: 'new@uir.ac.ma', active: false };
  await admin.patch(`/api/admin/students/${student.id}`).send(patch).expect(409);
  await admin.delete(`/api/reservations/${booking.id}`).expect(204);
  await admin.patch(`/api/admin/students/${student.id}`).send(patch).expect(200);
  await agent.get('/api/auth/me').expect(401);
  await agent.post('/api/auth/login').send({ email: 'new@uir.ac.ma', password: 'Password123!' }).expect(401);
  await admin.patch(`/api/admin/students/${student.id}`).send({ ...patch, active: true, password: 'Updated123!' }).expect(200);
  await agent.post('/api/auth/login').send({ email: 'new@uir.ac.ma', password: 'Updated123!' }).expect(200);
  assert.equal((await agent.get('/api/reservations')).body.reservations[0].status, 'cancelled');
  await agent.post('/api/auth/logout').expect(204);
  await agent.get('/api/auth/me').expect(401);
});

test('competing requests: one success for a slot, a student week, or a booking versus closure', async () => {
  let results = await Promise.all([
    amine.post('/api/reservations').send({ courtId: 1, date: '2026-11-06', hour: 20 }),
    sara.post('/api/reservations').send({ courtId: 1, date: '2026-11-06', hour: 20 }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  await admin.delete(`/api/reservations/${results.find(r => r.status === 201)!.body.reservation.id}`).expect(204);
  results = await Promise.all([
    amine.post('/api/reservations').send({ courtId: 1, date: '2026-11-06', hour: 20 }),
    amine.post('/api/reservations').send({ courtId: 2, date: '2026-11-06', hour: 20 }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(results.find(r => r.status === 409)!.body.code, 'WEEKLY_LIMIT');
  await admin.delete(`/api/reservations/${results.find(r => r.status === 201)!.body.reservation.id}`).expect(204);
  results = await Promise.all([
    sara.post('/api/reservations').send({ courtId: 1, date: '2026-11-06', hour: 20 }),
    admin.post('/api/admin/closures').send({ courtId: 1, date: '2026-11-06', startHour: 20, endHour: 21, reason: 'Court event' }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const winner = results.find(r => r.status === 201)!.body;
  if (winner.reservation) await admin.delete(`/api/reservations/${winner.reservation.id}`).expect(204);
  else await admin.delete(`/api/admin/closures/${winner.closure.id}`).expect(204);
});

test('started bookings cannot be changed by students; admins may cancel them', async () => {
  const past = await fixture.db.query("INSERT INTO reservations(student_id,court_id,date,hour) VALUES($1,1,'2026-11-04',16) RETURNING id", [ids.youssef]);
  const id = past.rows[0].id;
  await youssef.delete(`/api/reservations/${id}`).expect(400);
  await youssef.patch(`/api/reservations/${id}`).send({ courtId: 2, date: '2026-11-06', hour: 20 }).expect(400);
  await admin.delete(`/api/reservations/${id}`).expect(204);
});
