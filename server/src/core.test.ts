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

test('kill badges advance every 100 kills', () => {
  assert.equal(badgeFor(99), null);
  assert.deepEqual(badgeFor(100), { level: 100, label: '100 KILLS' });
  assert.deepEqual(badgeFor(299), { level: 200, label: '200 KILLS' });
  assert.deepEqual(badgeFor(300), { level: 300, label: '300 KILLS' });
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
});
