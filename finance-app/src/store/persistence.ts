/**
 * Local-first persistence in IndexedDB, with optional passphrase encryption at rest.
 *
 * - Data never leaves the device unless the user exports it.
 * - With a passphrase set, each workspace is encrypted with AES-GCM (256-bit) using a key
 *   derived with PBKDF2-SHA-256 (600,000 iterations) and a random salt. The passphrase
 *   and key live only in memory; forgetting the passphrase means the data cannot be
 *   recovered (export a backup first).
 */
import { createStore, del, get, set } from 'idb-keyval';
import type { WorkspaceData } from '@/domain/types';

const store = typeof indexedDB !== 'undefined' ? createStore('ledgerline', 'kv') : undefined;
const PBKDF2_ITERATIONS = 600_000;

export type WorkspaceKind = WorkspaceData['kind'];

interface PlainRecord {
  format: 'plain';
  savedAt: string;
  data: WorkspaceData;
}
interface EncryptedRecord {
  format: 'aes-gcm';
  savedAt: string;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
}
type StoredRecord = PlainRecord | EncryptedRecord;

export interface Meta {
  activeWorkspace: WorkspaceKind;
  encrypted: boolean;
  /** Encrypted marker used to verify a passphrase without decrypting all data. */
  check?: { salt: string; iv: string; ciphertext: string; iterations: number };
}

const META_KEY = 'meta';
const wsKey = (k: WorkspaceKind) => `workspace:${k}`;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(out);
}

export async function deriveKey(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface KeyMaterial {
  key: CryptoKey;
  salt: Uint8Array;
}

async function encrypt(json: string, km: KeyMaterial) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, km.key, new TextEncoder().encode(json));
  return { salt: b64(km.salt), iv: b64(iv), ciphertext: bytesToBase64(new Uint8Array(ct)), iterations: PBKDF2_ITERATIONS };
}

async function decrypt(rec: { iv: string; ciphertext: string }, key: CryptoKey): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ciphertext));
  return new TextDecoder().decode(pt);
}

export async function loadMeta(): Promise<Meta> {
  if (!store) return { activeWorkspace: 'real', encrypted: false };
  return ((await get(META_KEY, store)) as Meta | undefined) ?? { activeWorkspace: 'real', encrypted: false };
}

export async function saveMeta(meta: Meta): Promise<void> {
  if (store) await set(META_KEY, meta, store);
}

export async function unlock(passphrase: string, meta: Meta): Promise<KeyMaterial> {
  if (!meta.check) throw new Error('No passphrase is set.');
  const salt = unb64(meta.check.salt);
  const key = await deriveKey(passphrase, salt, meta.check.iterations);
  try {
    const marker = await decrypt(meta.check, key);
    if (marker !== 'ledgerline') throw new Error('bad marker');
  } catch {
    throw new Error('Incorrect passphrase.');
  }
  return { key, salt };
}

export async function createKey(passphrase: string): Promise<{ km: KeyMaterial; check: NonNullable<Meta['check']> }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const km = { key, salt };
  const check = await encrypt('ledgerline', km);
  return { km, check };
}

export async function loadWorkspace(kind: WorkspaceKind, km: KeyMaterial | null): Promise<WorkspaceData | null> {
  if (!store) return null;
  const rec = (await get(wsKey(kind), store)) as StoredRecord | undefined;
  if (!rec) return null;
  if (rec.format === 'plain') return rec.data;
  if (!km) throw new Error('locked');
  return JSON.parse(await decrypt(rec, km.key)) as WorkspaceData;
}

export async function saveWorkspace(data: WorkspaceData, km: KeyMaterial | null): Promise<void> {
  if (!store) return;
  const savedAt = new Date().toISOString();
  const rec: StoredRecord = km ? { format: 'aes-gcm', savedAt, ...(await encrypt(JSON.stringify(data), km)) } : { format: 'plain', savedAt, data };
  await set(wsKey(data.kind), rec, store);
}

export async function deleteWorkspace(kind: WorkspaceKind): Promise<void> {
  if (store) await del(wsKey(kind), store);
}

export async function deleteEverything(): Promise<void> {
  if (!store) return;
  await del(wsKey('real'), store);
  await del(wsKey('demo'), store);
  await del(META_KEY, store);
}

/** Ask the browser not to evict our storage under pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
