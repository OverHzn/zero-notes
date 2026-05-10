'use strict';

// Optional client-side encryption for the appDataFolder sync payload.
//
// When `settings.encryptCloudSync` is true, the JSON payload uploaded to
// Drive's appDataFolder is encrypted with AES-256-GCM. The key is derived
// from a passphrase via scrypt; the passphrase is held only on the user's
// machine — we never upload it. If the user enables this and forgets the
// passphrase, the cloud copy is unrecoverable (by design).
//
// Storage format (string):
//   ZN-ENC-v1:<base64(salt)>:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>

const crypto = require('node:crypto');

const PREFIX = 'ZN-ENC-v1';

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, { N: 1 << 14, r: 8, p: 1 });
}

function encrypt(plaintext, passphrase) {
  if (!passphrase) throw new Error('Passphrase required for encrypted sync');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    ct.toString('base64'),
  ].join(':');
}

function isEncrypted(text) {
  return typeof text === 'string' && text.startsWith(`${PREFIX}:`);
}

function decrypt(text, passphrase) {
  if (!isEncrypted(text)) {
    throw new Error('Payload is not encrypted with Zero Notes encryption');
  }
  if (!passphrase) throw new Error('Passphrase required to decrypt sync payload');
  const [, saltB64, ivB64, tagB64, ctB64] = text.split(':');
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

module.exports = { encrypt, decrypt, isEncrypted };
