import { buildApp } from './app.js';
import { migrate, pool } from './db.js';

const port = Number(process.env.PORT || 3000);

try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await migrate();
  const app = await buildApp();
  const close = async () => { await app.close(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
  await app.listen({ host: '0.0.0.0', port });
} catch (error) {
  console.error(error); await pool.end(); process.exit(1);
}
