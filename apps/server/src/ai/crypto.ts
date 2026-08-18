import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

const KEY = Buffer.from(env.appEncryptionKey, 'base64');
if (KEY.length !== 32) {
  throw new Error('APP_ENCRYPTION_KEY must be 32 raw bytes, base64-encoded');
}

/**
 * AES-256-GCM. Stored as `iv:tag:ciphertext`, each part base64.
 * Provider API keys are never returned over HTTP — the API exposes keyLast4.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decrypt(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function keyLast4(stored: string): string {
  try {
    const key = decrypt(stored);
    return key.slice(-4);
  } catch {
    return '????';
  }
}

/** Constant-time string compare, for the admin signup code. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
