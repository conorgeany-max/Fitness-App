/**
 * Encrypted file store for server-side secrets about connections (provider user ids,
 * connection ids). AES-256-GCM with a key from SERVER_ENCRYPTION_KEY (32 bytes, base64).
 * In development a key is generated into server/.data/dev.key with a warning; production
 * refuses to start without a configured key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConnectionRecord } from './providers/types';

export function loadKey(dataDir: string, production: boolean): Buffer {
  const env = process.env.SERVER_ENCRYPTION_KEY;
  if (env) {
    const key = Buffer.from(env, 'base64');
    if (key.length !== 32) throw new Error('SERVER_ENCRYPTION_KEY must be 32 bytes, base64-encoded (e.g. `openssl rand -base64 32`).');
    return key;
  }
  if (production) throw new Error('SERVER_ENCRYPTION_KEY is required in production.');
  const file = join(dataDir, 'dev.key');
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  console.warn('[vault] No SERVER_ENCRYPTION_KEY set; generated a development key in server/.data/dev.key. Do not use this in production.');
  return key;
}

export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function decrypt(key: Buffer, blob: string): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1') throw new Error('Unknown vault format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

export class ConnectionVault {
  private records = new Map<string, ConnectionRecord>();
  constructor(
    private readonly file: string,
    private readonly key: Buffer,
  ) {
    if (existsSync(file)) {
      const list = JSON.parse(decrypt(key, readFileSync(file, 'utf8'))) as ConnectionRecord[];
      for (const r of list) this.records.set(r.id, r);
    }
  }
  get(id: string) {
    return this.records.get(id);
  }
  list() {
    return [...this.records.values()];
  }
  put(r: ConnectionRecord) {
    this.records.set(r.id, r);
    this.flush();
  }
  delete(id: string) {
    this.records.delete(id);
    this.flush();
  }
  private flush() {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, encrypt(this.key, JSON.stringify(this.list())), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
