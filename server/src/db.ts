import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
});

pool.on('error', (error) => console.error('postgres idle client error', error));

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const directory = process.env.MIGRATIONS_DIR || join(process.cwd(), 'migrations');
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (exists.rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(join(directory, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied migration ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}
