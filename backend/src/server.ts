import { createApp } from './app.js';
import { initialize, pool } from './db.js';

await initialize();
const server = createApp().listen(3000, '0.0.0.0', () => console.log('UIR Padel API listening on port 3000'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => { pool.end().then(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
