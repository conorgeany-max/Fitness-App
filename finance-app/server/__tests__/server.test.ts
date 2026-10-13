import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FetchRefused, htmlToText, isPrivateAddress, robotsAllows, validateUrl } from '../listing';
import { ConnectionVault, decrypt, encrypt } from '../vault';
import { mockProvider } from '../providers/mock';

describe('listing fetch guards', () => {
  it('flags private, loopback, link-local and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['1.1.1.1', '172.32.0.1', '104.16.0.200', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses non-web schemes, credentials, odd ports and raw IPs', () => {
    expect(() => validateUrl('file:///etc/passwd')).toThrow(FetchRefused);
    expect(() => validateUrl('https://user:pw@example.com/')).toThrow(FetchRefused);
    expect(() => validateUrl('https://example.com:8080/')).toThrow(FetchRefused);
    expect(() => validateUrl('http://127.0.0.1/')).toThrow(FetchRefused);
    expect(() => validateUrl('http://localhost/')).toThrow(FetchRefused);
    expect(() => validateUrl('not a url')).toThrow(FetchRefused);
    expect(validateUrl('https://www.example.com.au/property/123').hostname).toBe('www.example.com.au');
  });

  it('honours robots.txt for our agent and for *', () => {
    const robots = 'User-agent: *\nDisallow: /property/\nAllow: /property/public/\n\nUser-agent: OtherBot\nDisallow: /';
    expect(robotsAllows(robots, '/property/123')).toBe(false);
    expect(robotsAllows(robots, '/property/public/9')).toBe(true);
    expect(robotsAllows(robots, '/news')).toBe(true);
    expect(robotsAllows('User-agent: HouseholdFinanceListingReader\nDisallow: /', '/anything')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow:', '/anything')).toBe(true);
    expect(robotsAllows('', '/anything')).toBe(true);
  });

  it('turns HTML into readable text without scripts', () => {
    const t = htmlToText('<html><script>alert(1)</script><h1>2 bed apartment</h1><p>Price guide &#36;560,000&nbsp;&amp; up</p></html>');
    expect(t).toContain('2 bed apartment');
    expect(t).toContain('Price guide $560,000 & up');
    expect(t).not.toContain('alert');
  });
});

describe('vault', () => {
  const key = randomBytes(32);
  it('round-trips and detects tampering', () => {
    const blob = encrypt(key, 'secret provider id');
    expect(blob).not.toContain('secret');
    expect(decrypt(key, blob)).toBe('secret provider id');
    const parts = blob.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decrypt(key, parts.join('.'))).toThrow();
    expect(() => decrypt(randomBytes(32), blob)).toThrow();
  });

  it('persists connection records encrypted on disk', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'vault-')), 'c.enc');
    const v = new ConnectionVault(file, key);
    v.put({ id: 'conn_x', provider: 'mock', owner: 'me', institutionId: 'mock-everyday', institutionName: 'Mock Bank', createdAt: '2026-10-13', providerUserId: 'user-abc' });
    const reopened = new ConnectionVault(file, key);
    expect(reopened.get('conn_x')?.providerUserId).toBe('user-abc');
    reopened.delete('conn_x');
    expect(new ConnectionVault(file, key).list()).toHaveLength(0);
  });
});

describe('mock provider', () => {
  const p = mockProvider(true);
  const start = (institutionId: string) => p.startConsent({ connectionId: 'conn_00000000-0000-0000-0000-000000000001', owner: 'me', institutionId });

  it('returns deterministic, labelled data with no consent URL', async () => {
    const { record, consentUrl } = await start('mock-everyday');
    expect(consentUrl).toBeNull();
    const a = await p.sync(record, { fromDate: '2026-08-01' });
    const b = await p.sync(record, { fromDate: '2026-08-01' });
    expect(a.environment).toBe('mock');
    expect(a.accounts.map((x) => x.balanceCents)).toEqual(b.accounts.map((x) => x.balanceCents));
    expect(a.transactions.length).toBeGreaterThan(10);
    expect(a.accounts.every((x) => !x.maskedNumber || /^xxxx \d{4}$/.test(x.maskedNumber))).toBe(true);
  });

  it('simulates expired consent and provider failures', async () => {
    await expect(p.sync((await start('mock-expired')).record, { fromDate: '2026-09-01' })).rejects.toMatchObject({ code: 'consent_expired' });
    await expect(p.sync((await start('mock-failing')).record, { fromDate: '2026-09-01' })).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('is off unless enabled', () => {
    expect(mockProvider(false).info().configured).toBe(false);
  });
});
