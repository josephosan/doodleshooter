import { randomBytes, randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { hashPassword, newSessionToken, tokenHash, verifyPassword } from './security.js';
import { badgeFor, COLORS, type AuthUser } from './types.js';
import * as validate from './validation.js';

const SESSION_COOKIE = 'doodle_session';
const SESSION_DAYS = 30;
const production = process.env.NODE_ENV === 'production';

type UserRow = AuthUser & {
  games_played: number | string;
  wins: number | string;
  kills: number | string;
  deaths: number | string;
  headshots: number | string;
  solo_games_played?: number | string;
  solo_kills?: number | string;
  solo_deaths?: number | string;
  solo_headshots?: number | string;
  solo_best_score?: number | string;
  solo_best_wave?: number | string;
  solo_play_seconds?: number | string;
};

function number(value: number | string | null | undefined): number { return Number(value || 0); }
function onlineStats(row: UserRow) {
  return {
    gamesPlayed: number(row.games_played), wins: number(row.wins), kills: number(row.kills),
    deaths: number(row.deaths), headshots: number(row.headshots),
  };
}

function publicProfile(row: UserRow) {
  const stats = onlineStats(row);
  return { id: row.id, username: row.username, color: row.color, stats, badge: badgeFor(stats.kills) };
}

function profile(row: UserRow) {
  const stats = onlineStats(row);
  const soloStats = {
    gamesPlayed: number(row.solo_games_played), kills: number(row.solo_kills), deaths: number(row.solo_deaths),
    headshots: number(row.solo_headshots), bestScore: number(row.solo_best_score), bestWave: number(row.solo_best_wave),
    playSeconds: number(row.solo_play_seconds),
  };
  return { ...publicProfile(row), soloStats };
}

const USER_SELECT = `SELECT u.id, u.username, u.color,
  s.games_played, s.wins, s.kills, s.deaths, s.headshots,
  ss.games_played AS solo_games_played, ss.kills AS solo_kills, ss.deaths AS solo_deaths,
  ss.headshots AS solo_headshots, ss.best_score AS solo_best_score, ss.best_wave AS solo_best_wave,
  ss.play_seconds AS solo_play_seconds
  FROM users u JOIN user_stats s ON s.user_id = u.id
  LEFT JOIN solo_stats ss ON ss.user_id = u.id`;

async function findUserById(id: string, client = pool): Promise<UserRow | null> {
  const result = await client.query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [id]);
  return result.rows[0] || null;
}

async function requestUser(request: FastifyRequest): Promise<UserRow | null> {
  const token = request.cookies[SESSION_COOKIE]; if (!token) return null;
  const result = await pool.query<UserRow>(`${USER_SELECT}
    JOIN sessions x ON x.user_id = u.id WHERE x.token_hash = $1 AND x.expires_at > now()`, [tokenHash(token)]);
  return result.rows[0] || null;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<UserRow | null> {
  const user = await requestUser(request);
  if (!user) { await reply.code(401).send({ error: 'Sign in to continue.' }); return null; }
  return user;
}

async function createSession(userId: string, reply: FastifyReply): Promise<void> {
  const token = newSessionToken();
  await pool.query(`INSERT INTO sessions(token_hash, user_id, expires_at)
    VALUES ($1, $2, now() + ($3 * interval '1 day'))`, [tokenHash(token), userId, SESSION_DAYS]);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86_400,
  });
}

function authBody(body: unknown): { username: string; password: string } | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  const username = validate.username(value.username), password = validate.password(value.password);
  return username && password ? { username, password } : null;
}

function leaderboardRows(rows: Array<Record<string, unknown>>) {
  return rows.map((row, index) => {
    const kills = number(row.kills as string | number);
    const badgeKills = number((row.badge_kills ?? row.kills) as string | number);
    return {
      rank: index + 1, id: row.id, username: row.username, color: row.color,
      kills, deaths: number(row.deaths as string | number), headshots: number(row.headshots as string | number),
      gamesPlayed: number(row.games_played as string | number), wins: number(row.wins as string | number), badge: badgeFor(badgeKills),
    };
  });
}

const DUEL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function roomCode(): string {
  const bytes = randomBytes(5);
  return Array.from(bytes, (byte) => DUEL_ALPHABET[byte! % DUEL_ALPHABET.length]).join('');
}

function duelRows(rows: Array<Record<string, unknown>>, viewerId: string) {
  return rows.map((row) => ({
    id: row.id, status: row.status, createdAt: row.created_at, expiresAt: row.expires_at,
    roomCode: row.status === 'accepted' ? row.room_code : null,
    direction: row.challenger_id === viewerId ? 'outgoing' : 'incoming',
    opponent: row.challenger_id === viewerId
      ? { id: row.challenged_id, username: row.challenged_username, color: row.challenged_color }
      : { id: row.challenger_id, username: row.challenger_username, color: row.challenger_color },
  }));
}

export async function buildApp() {
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 32 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 180, timeWindow: '1 minute' });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
  });

  app.get('/api/health', async (_request, reply) => {
    await pool.query('SELECT 1'); return reply.send({ ok: true, database: 'ready' });
  });

  app.post('/api/auth/signup', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = authBody(request.body);
    if (!input) return reply.code(400).send({ error: 'Username must be 3–14 letters, numbers, or underscores; password must be at least 8 characters.' });
    const secure = await hashPassword(input.password); const id = randomUUID(); const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO users(id, username, password_hash, password_salt) VALUES ($1, $2, $3, $4)`, [id, input.username, secure.hash, secure.salt]);
      await client.query('INSERT INTO user_stats(user_id) VALUES ($1)', [id]);
      await client.query('INSERT INTO solo_stats(user_id) VALUES ($1)', [id]);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'That username is already taken.' });
      throw error;
    } finally { client.release(); }
    await createSession(id, reply); const user = await findUserById(id);
    return reply.code(201).send({ user: profile(user!) });
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = authBody(request.body);
    if (!input) return reply.code(400).send({ error: 'Enter a valid username and password.' });
    const found = await pool.query<UserRow & { password_hash: string; password_salt: string }>(`SELECT u.id, u.username, u.color, u.password_hash, u.password_salt,
      s.games_played, s.wins, s.kills, s.deaths, s.headshots
      FROM users u JOIN user_stats s ON s.user_id = u.id WHERE u.username_key = lower($1)`, [input.username]);
    const user = found.rows[0];
    if (!user || !(await verifyPassword(input.password, user.password_salt, user.password_hash))) return reply.code(401).send({ error: 'Username or password is incorrect.' });
    await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
    await createSession(user.id, reply); return reply.send({ user: profile((await findUserById(user.id))!) });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' }); return reply.send({ ok: true });
  });

  app.get('/api/me', async (request, reply) => {
    const user = await requestUser(request); return reply.send({ user: user ? profile(user) : null });
  });

  app.get('/api/profiles/:username', async (request, reply) => {
    const username = validate.username((request.params as { username: string }).username);
    if (!username) return reply.code(404).send({ error: 'Player not found.' });
    const found = await pool.query<UserRow>(`${USER_SELECT} WHERE u.username_key = lower($1)`, [username]);
    const user = found.rows[0];
    if (!user) return reply.code(404).send({ error: 'Player not found.' });
    const games = await pool.query(`SELECT g.mode, g.map_key AS "mapKey", g.ended_at AS "endedAt",
      gp.kills, gp.deaths, gp.headshots, gp.result
      FROM game_players gp JOIN games g ON g.id = gp.game_id
      WHERE gp.user_id = $1 ORDER BY g.ended_at DESC LIMIT 5`, [user.id]);
    return reply.send({ user: publicProfile(user), recentGames: games.rows });
  });

  app.get('/api/players/search', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const q = String((request.query as Record<string, unknown>).q || '').trim();
    if (q.length < 2 || q.length > 14) return reply.send({ rows: [] });
    const result = await pool.query(`SELECT u.id, u.username, u.color, s.kills, s.deaths, s.headshots, s.games_played, s.wins
      FROM users u JOIN user_stats s ON s.user_id = u.id
      WHERE u.id <> $1 AND u.username_key LIKE lower($2) || '%'
      ORDER BY CASE WHEN u.username_key = lower($2) THEN 0 ELSE 1 END, s.kills DESC, u.username ASC LIMIT 10`, [user.id, q]);
    return reply.send({ rows: result.rows.map((row) => publicProfile(row as UserRow)) });
  });

  app.get('/api/account/username/check', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = validate.username((request.query as Record<string, unknown>).username);
    if (!input) return reply.code(400).send({ available: false, error: 'Use 3–14 letters, numbers, or underscores.' });
    const user = await requestUser(request);
    const exists = await pool.query('SELECT id FROM users WHERE username_key = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)', [input, user?.id || null]);
    return reply.send({ username: input, available: !exists.rowCount });
  });

  app.put('/api/account/username', { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const input = validate.username((request.body as Record<string, unknown> | null)?.username);
    if (!input) return reply.code(400).send({ error: 'Use 3–14 letters, numbers, or underscores.' });
    try { await pool.query('UPDATE users SET username = $1, updated_at = now() WHERE id = $2', [input, user.id]); }
    catch (error: unknown) { if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'That username is already taken.' }); throw error; }
    return reply.send({ user: profile((await findUserById(user.id))!) });
  });

  app.put('/api/account/color', async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const input = validate.color((request.body as Record<string, unknown> | null)?.color);
    if (!input) return reply.code(400).send({ error: `Choose one of: ${COLORS.join(', ')}.` });
    await pool.query('UPDATE users SET color = $1, updated_at = now() WHERE id = $2', [input, user.id]);
    return reply.send({ user: profile((await findUserById(user.id))!) });
  });

  app.get('/api/leaderboards/:scope', async (request, reply) => {
    const scope = (request.params as { scope: string }).scope;
    if (scope !== 'weekly' && scope !== 'all-time') return reply.code(404).send({ error: 'Leaderboard not found.' });
    if (scope === 'all-time') {
      const result = await pool.query(`SELECT u.id, u.username, u.color, s.games_played, s.wins, s.kills, s.deaths, s.headshots
        FROM user_stats s JOIN users u ON u.id = s.user_id WHERE s.games_played > 0
        ORDER BY s.kills DESC, s.headshots DESC, s.deaths ASC, u.created_at ASC LIMIT 10`);
      return reply.send({ scope, rows: leaderboardRows(result.rows), resetAt: null });
    }
    const result = await pool.query(`SELECT u.id, u.username, u.color, s.kills AS badge_kills, count(*)::int AS games_played,
      count(*) FILTER (WHERE gp.result = 'win')::int AS wins,
      sum(gp.kills)::bigint AS kills, sum(gp.deaths)::bigint AS deaths, sum(gp.headshots)::bigint AS headshots
      FROM game_players gp JOIN games g ON g.id = gp.game_id JOIN users u ON u.id = gp.user_id JOIN user_stats s ON s.user_id = u.id
      WHERE g.ended_at >= date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      GROUP BY u.id, u.username, u.color, u.created_at, s.kills
      ORDER BY kills DESC, headshots DESC, deaths ASC, u.created_at ASC LIMIT 10`);
    const reset = await pool.query<{ reset_at: string }>(`SELECT (date_trunc('week', now() AT TIME ZONE 'UTC') + interval '1 week') AT TIME ZONE 'UTC' AS reset_at`);
    return reply.send({ scope, rows: leaderboardRows(result.rows), resetAt: reset.rows[0]?.reset_at || null });
  });

  app.get('/api/me/games', async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const result = await pool.query(`SELECT g.id, g.mode, g.map_key AS "mapKey", g.started_at AS "startedAt", g.ended_at AS "endedAt",
      g.duration_seconds AS "durationSeconds", gp.team, gp.color, gp.kills, gp.deaths, gp.headshots, gp.result
      FROM game_players gp JOIN games g ON g.id = gp.game_id WHERE gp.user_id = $1 ORDER BY g.ended_at DESC LIMIT 20`, [user.id]);
    return reply.send({ games: result.rows });
  });

  app.get('/api/me/solo-runs', async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const result = await pool.query(`SELECT id, map_key AS "mapKey", score, wave, kills, deaths, headshots,
      duration_seconds AS "durationSeconds", ended_reason AS "endedReason", ended_at AS "endedAt"
      FROM solo_runs WHERE user_id = $1 ORDER BY ended_at DESC LIMIT 12`, [user.id]);
    return reply.send({ runs: result.rows });
  });

  app.post('/api/solo-runs/:id', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const runId = validate.uuid((request.params as { id: string }).id), body = request.body as Record<string, unknown> | null;
    const mapKey = validate.mapKey(body?.mapKey), score = validate.integer(body?.score, 0, 1_000_000_000);
    const wave = validate.integer(body?.wave, 0, 10_000), kills = validate.integer(body?.kills, 0, 100_000);
    const deaths = validate.integer(body?.deaths, 0, 1), headshots = validate.integer(body?.headshots, 0, 100_000);
    const duration = validate.integer(body?.durationSeconds, 0, 86_400), endedReason = validate.soloEndReason(body?.endedReason);
    if (!runId || !body || !mapKey || score === null || wave === null || kills === null || deaths === null || headshots === null || duration === null || !endedReason || headshots > kills) {
      return reply.code(400).send({ error: 'Invalid offline run.' });
    }
    const client = await pool.connect(); let recorded = false;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`INSERT INTO solo_runs(id, user_id, map_key, score, wave, kills, deaths, headshots, duration_seconds, ended_reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [runId, user.id, mapKey, score, wave, kills, deaths, headshots, duration, endedReason]);
      recorded = Boolean(inserted.rowCount);
      if (recorded) await client.query(`INSERT INTO solo_stats(user_id, games_played, kills, deaths, headshots, best_score, best_wave, play_seconds)
        VALUES ($1,1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (user_id) DO UPDATE SET games_played = solo_stats.games_played + 1,
          kills = solo_stats.kills + EXCLUDED.kills, deaths = solo_stats.deaths + EXCLUDED.deaths,
          headshots = solo_stats.headshots + EXCLUDED.headshots, best_score = GREATEST(solo_stats.best_score, EXCLUDED.best_score),
          best_wave = GREATEST(solo_stats.best_wave, EXCLUDED.best_wave), play_seconds = solo_stats.play_seconds + EXCLUDED.play_seconds,
          updated_at = now()`, [user.id, kills, deaths, headshots, score, wave, duration]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return reply.code(recorded ? 201 : 200).send({ recorded, user: profile((await findUserById(user.id))!) });
  });

  app.get('/api/duels', async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    await pool.query(`UPDATE duel_requests SET status = 'expired' WHERE status IN ('pending','accepted') AND expires_at <= now()`);
    const result = await pool.query(`SELECT d.*, c.username AS challenger_username, c.color AS challenger_color,
      t.username AS challenged_username, t.color AS challenged_color
      FROM duel_requests d JOIN users c ON c.id = d.challenger_id JOIN users t ON t.id = d.challenged_id
      WHERE (d.challenger_id = $1 OR d.challenged_id = $1) AND d.status IN ('pending','accepted')
      ORDER BY d.created_at DESC LIMIT 30`, [user.id]);
    const rows = duelRows(result.rows, user.id);
    return reply.send({ incoming: rows.filter((row) => row.direction === 'incoming'), outgoing: rows.filter((row) => row.direction === 'outgoing') });
  });

  app.post('/api/duels', { config: { rateLimit: { max: 12, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const username = validate.username((request.body as Record<string, unknown> | null)?.username);
    if (!username) return reply.code(400).send({ error: 'Choose a valid player.' });
    const targetResult = await pool.query<AuthUser>('SELECT id, username, color FROM users WHERE username_key = lower($1)', [username]);
    const target = targetResult.rows[0];
    if (!target) return reply.code(404).send({ error: 'Player not found.' });
    if (target.id === user.id) return reply.code(400).send({ error: 'You cannot duel yourself.' });
    const existing = await pool.query(`SELECT id FROM duel_requests WHERE status IN ('pending','accepted') AND expires_at > now()
      AND ((challenger_id = $1 AND challenged_id = $2) OR (challenger_id = $2 AND challenged_id = $1)) LIMIT 1`, [user.id, target.id]);
    if (existing.rowCount) return reply.code(409).send({ error: 'There is already an active duel request between you.' });
    let inserted = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      try {
        const id = randomUUID(), code = roomCode();
        const result = await pool.query(`INSERT INTO duel_requests(id, challenger_id, challenged_id, room_code)
          VALUES ($1,$2,$3,$4) RETURNING id, status, created_at, expires_at`, [id, user.id, target.id, code]);
        inserted = result.rows[0];
      } catch (error: unknown) {
        if ((error as { code?: string }).code !== '23505') throw error;
      }
    }
    if (!inserted) return reply.code(503).send({ error: 'Could not reserve a duel room. Try again.' });
    return reply.code(201).send({ duel: { ...inserted, direction: 'outgoing', roomCode: null, opponent: target } });
  });

  app.post('/api/duels/:id/respond', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const id = validate.uuid((request.params as { id: string }).id), action = validate.duelAction((request.body as Record<string, unknown> | null)?.action);
    if (!id || !action) return reply.code(400).send({ error: 'Invalid duel response.' });
    const status = action === 'accept' ? 'accepted' : 'declined';
    const result = await pool.query(`UPDATE duel_requests SET status = $1::varchar, responded_at = now(),
      expires_at = CASE WHEN $1::text = 'accepted' THEN now() + interval '10 minutes' ELSE expires_at END
      WHERE id = $2 AND challenged_id = $3 AND status = 'pending' AND expires_at > now()
      RETURNING id, room_code, status, expires_at`, [status, id, user.id]);
    if (!result.rowCount) return reply.code(409).send({ error: 'That duel request is no longer active.' });
    const duel = result.rows[0];
    return reply.send({ duel: { id: duel.id, status: duel.status, roomCode: action === 'accept' ? duel.room_code : null, expiresAt: duel.expires_at } });
  });

  app.delete('/api/duels/:id', async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const id = validate.uuid((request.params as { id: string }).id);
    if (!id) return reply.code(400).send({ error: 'Invalid duel request.' });
    const result = await pool.query(`UPDATE duel_requests SET status = 'cancelled', responded_at = now()
      WHERE id = $1 AND challenger_id = $2 AND status IN ('pending','accepted') RETURNING id`, [id, user.id]);
    if (!result.rowCount) return reply.code(409).send({ error: 'That duel request is no longer active.' });
    return reply.send({ ok: true });
  });

  app.post('/api/games/:id/results', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const gameId = validate.uuid((request.params as { id: string }).id), body = request.body as Record<string, unknown> | null;
    const matchMode = validate.mode(body?.mode), mapKey = validate.mapKey(body?.mapKey), duration = validate.integer(body?.durationSeconds, 0, 7200);
    const kills = validate.integer(body?.kills, 0, 1000), deaths = validate.integer(body?.deaths, 0, 1000), headshots = validate.integer(body?.headshots, 0, 1000);
    const result = validate.result(body?.result), playerColor = validate.color(body?.color);
    const team = body?.team === null && matchMode === 'ffa' ? null : body?.team === 'red' || body?.team === 'black' ? body.team : null;
    if (!gameId || !body || !matchMode || !mapKey || duration === null || kills === null || deaths === null || headshots === null || !result || !playerColor || headshots > kills || (matchMode === 'teams' && !team)) {
      return reply.code(400).send({ error: 'Invalid match result.' });
    }
    const client = await pool.connect(); let recorded = false;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO games(id, mode, map_key, started_at, ended_at, duration_seconds)
        VALUES ($1, $2, $3, now() - ($4 * interval '1 second'), now(), $4) ON CONFLICT (id) DO NOTHING`, [gameId, matchMode, mapKey, duration]);
      const game = await client.query<{ mode: string; map_key: string }>('SELECT mode, map_key FROM games WHERE id = $1 FOR UPDATE', [gameId]);
      if (!game.rows[0] || game.rows[0].mode !== matchMode || game.rows[0].map_key !== mapKey) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'Match identity conflicts with an existing game.' });
      }
      const inserted = await client.query(`INSERT INTO game_players(game_id, user_id, username_snapshot, team, color, kills, deaths, headshots, result)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (game_id, user_id) DO NOTHING RETURNING user_id`,
      [gameId, user.id, user.username, team, playerColor, kills, deaths, headshots, result]);
      recorded = Boolean(inserted.rowCount);
      if (recorded) await client.query(`UPDATE user_stats SET games_played = games_played + 1,
        wins = wins + $2, kills = kills + $3, deaths = deaths + $4, headshots = headshots + $5, updated_at = now() WHERE user_id = $1`,
      [user.id, result === 'win' ? 1 : 0, kills, deaths, headshots]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return reply.code(recorded ? 201 : 200).send({ recorded, user: profile((await findUserById(user.id))!) });
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error); const known = error as { statusCode?: number; message?: string };
    const status = known.statusCode && known.statusCode < 500 ? known.statusCode : 500;
    reply.code(status).send({ error: status >= 500 ? 'Server error. Try again shortly.' : known.message || 'Request failed.' });
  });
  return app;
}
