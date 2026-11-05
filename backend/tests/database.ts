import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

// PGlite runs the PostgreSQL engine in-process. Serialize access because it has
// one connection; real multi-connection races are tested separately against pg.
export async function testDatabase() {
  if (process.env.TEST_DATABASE_URL) {
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    const setup = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await setup.query(`CREATE SCHEMA ${schema}`);
    const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 10 });
    await db.query(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
    await seedTestAccounts(db);
    return { db, close: async () => { await db.end(); await setup.query(`DROP SCHEMA ${schema} CASCADE`); await setup.end(); } };
  }
  const engine = new PGlite({ parsers: { 1082: (value: string) => value } });
  await engine.exec(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    return release;
  }
  async function query(sql: string, values: unknown[] = []) {
    const result = await engine.query(sql, values);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  }
  const adapter = {
    async query(sql: string, values?: unknown[]) {
      const release = await acquire();
      try { return await query(sql, values); } finally { release(); }
    },
    async connect() { const release = await acquire(); return { query, release }; },
  } as unknown as pg.Pool;
  await seedTestAccounts(adapter);
  return { db: adapter, close: () => engine.close() };
}

async function seedTestAccounts(db: pg.Pool) {
  const hash = await bcrypt.hash('Student123!', 4);
  for (const [name, email, role] of [
    ['Admin Test', 'admin@uir.ac.ma', 'admin'],
    ['Amine Bennani', 'amine@uir.ac.ma', 'student'],
    ['Sara El Amrani', 'sara@uir.ac.ma', 'student'],
    ['Youssef Alaoui', 'youssef@uir.ac.ma', 'student'],
  ]) await db.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)', [name, email, role === 'admin' ? await bcrypt.hash('Admin123!', 4) : hash, role]);
}
