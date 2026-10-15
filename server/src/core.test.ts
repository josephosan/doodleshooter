import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, tokenHash, verifyPassword } from './security.js';
import { badgeFor } from './types.js';
import * as validate from './validation.js';

test('usernames match the multiplayer display limit', () => {
  assert.equal(validate.username('player_123'), 'player_123');
  assert.equal(validate.username('ab'), null);
  assert.equal(validate.username('123456789012345'), null);
  assert.equal(validate.username('bad name'), null);
});

test('kill badges use the named all-time thresholds', () => {
  assert.equal(badgeFor(99), null);
  assert.deepEqual(badgeFor(100), { level: 100, label: 'dolche' });
  assert.deepEqual(badgeFor(499), { level: 100, label: 'dolche' });
  assert.deepEqual(badgeFor(500), { level: 500, label: 'dolack' });
  assert.deepEqual(badgeFor(999), { level: 500, label: 'dolack' });
  assert.deepEqual(badgeFor(1000), { level: 1000, label: 'sardolche' });
  assert.deepEqual(badgeFor(2500), { level: 2500, label: 'sardol' });
  assert.deepEqual(badgeFor(3700), { level: 3700, label: 'dolbor' });
  assert.deepEqual(badgeFor(7000), { level: 7000, label: 'superdol' });
  assert.deepEqual(badgeFor(10000), { level: 10000, label: 'superdolplus' });
  assert.deepEqual(badgeFor(19999), { level: 10000, label: 'superdolplus' });
  assert.deepEqual(badgeFor(20000), { level: 20000, label: 'ultradolgod' });
  assert.deepEqual(badgeFor(999999), { level: 20000, label: 'ultradolgod' });
});

test('passwords are salted, verifiable, and session tokens are not stored raw', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword('correct horse battery staple', first.salt, first.hash), true);
  assert.equal(await verifyPassword('wrong password', first.salt, first.hash), false);
  assert.match(tokenHash('opaque-session-token'), /^[a-f0-9]{64}$/);
});

test('match result primitives reject invalid or inflated values', () => {
  assert.equal(validate.mode('teams'), 'teams');
  assert.equal(validate.mode('solo'), null);
  assert.equal(validate.integer(4, 0, 1000), 4);
  assert.equal(validate.integer(1001, 0, 1000), null);
  assert.equal(validate.integer(4.5, 0, 1000), null);
  assert.equal(validate.soloEndReason('death'), 'death');
  assert.equal(validate.soloEndReason('online'), null);
  assert.equal(validate.duelAction('accept'), 'accept');
  assert.equal(validate.duelAction('block'), null);
});
