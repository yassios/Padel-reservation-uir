import express, { type Request, type Response, type NextFunction } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type pg from 'pg';
import { pool } from './db.js';
import { HttpError, validateSlot, assertNotStarted, nowLocal, ZONE } from './rules.js';

declare module 'express-session' { interface SessionData { userId: string } }
type User = { id: string; name: string; email: string; role: 'admin' | 'student'; active: boolean };
declare global { namespace Express { interface Request { user: User } } }

const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };
const uuid = z.string().uuid();
const slotSchema = z.object({ courtId: z.number().int().min(1).max(2), date: z.string(), hour: z.number().int() });
const studentSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(8).max(72) });

export function createApp(db: pg.Pool = pool, sessionStore?: session.Store) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // Require same-origin browser writes. No cross-origin API access is enabled.
  app.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (req.get('sec-fetch-site') === 'cross-site') return next(new HttpError(403, 'Cross-site requests are not allowed.'));
      if (origin) {
        try { if (new URL(origin).host !== req.get('host')) return next(new HttpError(403, 'Invalid request origin.')); }
        catch { return next(new HttpError(403, 'Invalid request origin.')); }
      }
    }
    next();
  });
  const PgStore = connectPgSimple(session);
  app.use(session({
    store: sessionStore ?? new PgStore({ pool: db, createTableIfMissing: false }),
    secret: process.env.SESSION_SECRET || 'local-demo-secret-change-before-deployment-123456',
    name: 'uir.sid', resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 8 * 60 * 60 * 1000 },
  }));

  const transaction = async <T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
    const client = await db.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };
  const requireUser = asyncRoute(async (req, _res, next) => {
    if (!req.session.userId) throw new HttpError(401, 'Please sign in.', 'UNAUTHENTICATED');
    const { rows } = await db.query('SELECT id,name,email,role,active FROM users WHERE id=$1', [req.session.userId]);
    if (!rows[0]?.active) throw new HttpError(401, 'Your account is unavailable. Please contact the administrator.', 'UNAUTHENTICATED');
    req.user = rows[0]; next();
  });
  const requireAdmin = (req: Request, _res: Response, next: NextFunction) => {
    if (req.user.role !== 'admin') return next(new HttpError(403, 'Administrator access required.', 'FORBIDDEN'));
    next();
  };
  const lockStudent = async (client: pg.PoolClient, studentId: string) => {
    const result = await client.query("SELECT id FROM users WHERE id=$1 AND role='student' AND active=true FOR UPDATE", [studentId]);
    if (!result.rowCount) throw new HttpError(400, 'Select an active student.');
  };

  app.get('/api/health', asyncRoute(async (_req, res) => { await db.query('SELECT 1'); res.json({ status: 'ok' }); }));
  app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again in 15 minutes.', code: 'RATE_LIMITED' } }), asyncRoute(async (req, res) => {
    const { email, password } = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(72) }).parse(req.body);
    const result = await db.query('SELECT * FROM users WHERE email=$1', [email]);
    const user = result.rows[0];
    // Also hash-check unknown users to avoid a fast account-enumeration path.
    const valid = await bcrypt.compare(password, user?.password_hash ?? '$2b$12$q1AOaT4CzWSS1PqMRNHQ2uZBLAfw76X7oWORPcru5Zd3pxuGAj0Ye');
    if (!user?.active || !valid) throw new HttpError(401, 'Incorrect email or password.', 'INVALID_CREDENTIALS');
    await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active } });
  }));
  app.post('/api/auth/logout', (req, res, next) => {
    req.session.destroy(error => { if (error) return next(error); res.clearCookie('uir.sid', { path: '/' }); res.status(204).end(); });
  });
  app.get('/api/auth/me', requireUser, (req, res) => { res.json({ user: req.user }); });
  app.use('/api', requireUser);

  app.get('/api/availability', asyncRoute(async (_req, res) => {
    const now = nowLocal();
    const monday = now.startOf('week');
    const { rows } = await db.query(
      `SELECT s.*, c.reason FROM court_slots s LEFT JOIN closures c ON c.id=s.closure_id
       WHERE s.date BETWEEN $1::date AND $1::date + 4`, [monday.toISODate()]);
    const occupied = new Map(rows.map(row => [`${row.court_id}:${row.date}:${row.hour}`, row]));
    const slots = [];
    for (let day = 0; day < 5; day++) for (let hour = 16; hour < 22; hour++) for (const courtId of [1, 2]) {
      const date = monday.plus({ days: day }).toISODate()!;
      const occupation = occupied.get(`${courtId}:${date}:${hour}`);
      const past = monday.plus({ days: day }).set({ hour }).toMillis() <= now.toMillis();
      slots.push({ date, hour, courtId, state: occupation?.closure_id ? 'closed' : occupation ? 'booked' : past ? 'past' : 'available', reason: occupation?.reason ?? null });
    }
    res.json({ weekStart: monday.toISODate(), timezone: ZONE, now: now.toISO(), slots });
  }));

  app.get('/api/reservations', asyncRoute(async (req, res) => {
    const { rows } = await db.query(
      `SELECT r.*, u.name AS student_name, u.email AS student_email, c.name AS court_name
       FROM reservations r JOIN users u ON u.id=r.student_id JOIN courts c ON c.id=r.court_id
       ${req.user.role === 'student' ? 'WHERE r.student_id=$1' : ''}
       ORDER BY r.date DESC, r.hour DESC, r.created_at DESC`, req.user.role === 'student' ? [req.user.id] : []);
    res.json({ reservations: rows });
  }));
  app.post('/api/reservations', asyncRoute(async (req, res) => {
    const slot = slotSchema.extend({ studentId: uuid.optional() }).parse(req.body);
    validateSlot(slot.date, slot.hour);
    const studentId = req.user.role === 'admin' ? slot.studentId : req.user.id;
    if (!studentId) throw new HttpError(400, 'Select a student.');
    const reservation = await transaction(async client => {
      await lockStudent(client, studentId);
      validateSlot(slot.date, slot.hour);
      const { rows } = await client.query('INSERT INTO reservations(student_id,court_id,date,hour) VALUES($1,$2,$3,$4) RETURNING *', [studentId, slot.courtId, slot.date, slot.hour]);
      await client.query('INSERT INTO court_slots(court_id,date,hour,reservation_id) VALUES($1,$2,$3,$4)', [slot.courtId, slot.date, slot.hour, rows[0].id]);
      return rows[0];
    });
    res.status(201).json({ reservation });
  }));
  app.patch('/api/reservations/:id', asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const slot = slotSchema.parse(req.body);
    validateSlot(slot.date, slot.hour);
    const reservation = await transaction(async client => {
      // Keep user -> reservation lock order consistent with account deactivation.
      const owner = await client.query('SELECT student_id FROM reservations WHERE id=$1', [id]);
      if (!owner.rowCount) throw new HttpError(404, 'Reservation not found.');
      if (req.user.role === 'student' && owner.rows[0].student_id !== req.user.id) throw new HttpError(403, 'You can only change your own reservations.');
      await lockStudent(client, owner.rows[0].student_id);
      const { rows } = await client.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [id]);
      const previous = rows[0];
      if (previous.status !== 'confirmed') throw new HttpError(400, 'Cancelled reservations cannot be changed.');
      assertNotStarted(previous.date, previous.hour);
      validateSlot(slot.date, slot.hour);
      await client.query('DELETE FROM court_slots WHERE reservation_id=$1', [id]);
      const result = await client.query('UPDATE reservations SET court_id=$1,date=$2,hour=$3,updated_at=now() WHERE id=$4 RETURNING *', [slot.courtId, slot.date, slot.hour, id]);
      await client.query('INSERT INTO court_slots(court_id,date,hour,reservation_id) VALUES($1,$2,$3,$4)', [slot.courtId, slot.date, slot.hour, id]);
      return result.rows[0];
    });
    res.json({ reservation });
  }));
  app.delete('/api/reservations/:id', asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await transaction(async client => {
      const { rows } = await client.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [id]);
      const booking = rows[0];
      if (!booking) throw new HttpError(404, 'Reservation not found.');
      if (req.user.role === 'student' && booking.student_id !== req.user.id) throw new HttpError(403, 'You can only cancel your own reservations.');
      if (booking.status === 'cancelled') return;
      if (req.user.role === 'student') assertNotStarted(booking.date, booking.hour);
      await client.query('DELETE FROM court_slots WHERE reservation_id=$1', [id]);
      await client.query("UPDATE reservations SET status='cancelled',updated_at=now() WHERE id=$1", [id]);
    });
    res.status(204).end();
  }));

  app.use('/api/admin', requireAdmin);
  app.get('/api/admin/students', asyncRoute(async (_req, res) => {
    const { rows } = await db.query("SELECT id,name,email,active,created_at FROM users WHERE role='student' ORDER BY name");
    res.json({ students: rows });
  }));
  app.post('/api/admin/students', asyncRoute(async (req, res) => {
    const data = studentSchema.parse(req.body);
    const hash = await bcrypt.hash(data.password, 12);
    const { rows } = await db.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'student') RETURNING id,name,email,active", [data.name, data.email, hash]);
    res.status(201).json({ student: rows[0] });
  }));
  app.patch('/api/admin/students/:id', asyncRoute(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const data = studentSchema.omit({ password: true }).extend({ password: z.string().min(8).max(72).optional(), active: z.boolean() }).parse(req.body);
    const hash = data.password ? await bcrypt.hash(data.password, 12) : null;
    const student = await transaction(async client => {
      const previous = await client.query("SELECT id FROM users WHERE id=$1 AND role='student' FOR UPDATE", [id]);
      if (!previous.rowCount) throw new HttpError(404, 'Student not found.');
      if (!data.active) {
        const upcoming = await client.query("SELECT id FROM reservations WHERE student_id=$1 AND status='confirmed' AND (date + make_time(hour,0,0)) AT TIME ZONE 'Africa/Casablanca' > $2::timestamptz", [id, nowLocal().toISO()]);
        if (upcoming.rowCount) throw new HttpError(409, 'Cancel this student’s future reservations before deactivating the account.', 'FUTURE_RESERVATIONS');
      }
      const result = await client.query('UPDATE users SET name=$1,email=$2,active=$3,password_hash=COALESCE($4,password_hash) WHERE id=$5 RETURNING id,name,email,active', [data.name, data.email, data.active, hash, id]);
      return result.rows[0];
    });
    res.json({ student });
  }));
  app.get('/api/admin/closures', asyncRoute(async (_req, res) => {
    const { rows } = await db.query('SELECT * FROM closures ORDER BY date DESC,start_hour');
    res.json({ closures: rows });
  }));
  app.post('/api/admin/closures', asyncRoute(async (req, res) => {
    const data = slotSchema.omit({ hour: true }).extend({ startHour: z.number().int(), endHour: z.number().int().max(22), reason: z.string().trim().min(3).max(200) }).parse(req.body);
    validateSlot(data.date, data.startHour, nowLocal(), false);
    if (data.endHour <= data.startHour) throw new HttpError(400, 'The closure must end after it starts.');
    const closure = await transaction(async client => {
      validateSlot(data.date, data.startHour, nowLocal(), false);
      const { rows } = await client.query('INSERT INTO closures(court_id,date,start_hour,end_hour,reason,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [data.courtId, data.date, data.startHour, data.endHour, data.reason, req.user.id]);
      for (let hour = data.startHour; hour < data.endHour; hour++) {
        await client.query('INSERT INTO court_slots(court_id,date,hour,closure_id) VALUES($1,$2,$3,$4)', [data.courtId, data.date, hour, rows[0].id]);
      }
      return rows[0];
    });
    res.status(201).json({ closure });
  }));
  app.delete('/api/admin/closures/:id', asyncRoute(async (req, res) => {
    const result = await db.query('DELETE FROM closures WHERE id=$1', [uuid.parse(req.params.id)]);
    if (!result.rowCount) throw new HttpError(404, 'Closure not found.');
    res.status(204).end();
  }));
  app.use((_req, _res, next) => next(new HttpError(404, 'Endpoint not found.')));
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), code: 'VALIDATION_ERROR' }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    if (error.code === '23505') {
      const weekly = error.constraint === 'one_booking_per_student_week';
      const email = error.constraint === 'users_email_key';
      res.status(409).json({ error: weekly ? 'This student already has a reservation this week.' : email ? 'This email is already in use.' : 'This slot is already booked or closed. Choose another slot.', code: weekly ? 'WEEKLY_LIMIT' : email ? 'EMAIL_EXISTS' : 'SLOT_CONFLICT' }); return;
    }
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') { res.status(400).json({ error: 'Invalid request body.', code: 'VALIDATION_ERROR' }); return; }
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'INTERNAL_ERROR' });
  });
  return app;
}
