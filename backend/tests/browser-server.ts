import session from 'express-session';
import { createApp } from '../src/app.js';
import { testDatabase } from './database.js';
import { Settings } from 'luxon';

// Browser smoke tests use a disposable PostgreSQL engine, never production data.
Settings.now = () => 1793872800000; // Thursday, 5 November 2026, 10:00 UTC
const fixture = await testDatabase();
const server = createApp(fixture.db, new session.MemoryStore()).listen(3000, '127.0.0.1', () => console.log('Disposable browser test API on port 3000'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { fixture.close().then(() => process.exit(0)); }));
