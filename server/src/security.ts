import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  return { hash: (await derive(password, salt)).toString('hex'), salt: salt.toString('hex') };
}

export async function verifyPassword(password: string, saltHex: string, expectedHex: string): Promise<boolean> {
  const actual = await derive(password, Buffer.from(saltHex, 'hex'));
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newSessionToken(): string { return randomBytes(32).toString('base64url'); }
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
