import pg from 'pg';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';

// Return calendar dates without converting them through the machine's timezone.
pg.types.setTypeParser(1082, value => value);
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function initialize() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(847215)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY)');
    const applied = await client.query("SELECT version FROM schema_migrations WHERE version = '001'");
    if (!applied.rowCount) {
      await client.query(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
      await client.query("INSERT INTO schema_migrations VALUES ('001')");
    }
    const accounts = [
      ['UIR Administrator', 'admin@uir.ac.ma', 'Admin123!', 'admin'],
      ['Amine Bennani', 'amine@uir.ac.ma', 'Student123!', 'student'],
      ['Sara El Amrani', 'sara@uir.ac.ma', 'Student123!', 'student'],
      ['Youssef Alaoui', 'youssef@uir.ac.ma', 'Student123!', 'student'],
    ];
    for (const [name, email, password, role] of accounts) {
      await client.query(
        'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING',
        [name, email, await bcrypt.hash(password, 12), role],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
