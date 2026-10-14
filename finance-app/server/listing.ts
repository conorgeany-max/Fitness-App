/**
 * Fetch a public listing page's text for the property analyser.
 *
 * Guard rails:
 * - https/http only, standard ports, no credentials in the URL.
 * - The host must resolve only to public addresses (blocks localhost, private, link-local,
 *   carrier-grade NAT and metadata ranges). The check runs on the address each connection
 *   actually uses, so DNS rebinding can't slip past it, and again on every redirect (SSRF).
 * - robots.txt is honoured for our user agent; if it disallows the path we don't fetch.
 * - 10 second timeout, 2 MB cap, HTML only. No cookies, no JavaScript execution.
 * Failures are reported as they are; the browser then asks the person to paste the text.
 */
import { lookup } from 'node:dns/promises';
import { lookup as lookupCb, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export const USER_AGENT = 'HouseholdFinanceListingReader/1.0 (+personal use; respects robots.txt)';
const MAX_BYTES = 2 * 1024 * 1024;

export class FetchRefused extends Error {}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  // IPv4-mapped or -compatible forms (::ffff:a.b.c.d, ::a.b.c.d) are judged by their IPv4 part.
  const embedded = v6.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) return isPrivateAddress(embedded[1]);
  if (isIP(v6) !== 6) return true;
  // Only global unicast (2000::/3) is public. Within it, 6to4 (2002::/16), Teredo (2001::/32) and
  // documentation (2001:db8::/32) can wrap or stand in for private addresses, so they're refused too.
  // Everything else, including NAT64 (64:ff9b::/96), loopback, link-local and unique local, is private.
  const [h1, h2] = v6.split(':').map((h) => parseInt(h || '0', 16));
  if (h1 < 0x2000 || h1 > 0x3fff) return true;
  if (h1 === 0x2002) return true;
  if (h1 === 0x2001 && (h2 === 0 || h2 === 0xdb8)) return true;
  return false;
}

export function validateUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchRefused('That is not a valid web address.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchRefused('Only http and https links can be fetched.');
  if (u.username || u.password) throw new FetchRefused('Links containing credentials are not fetched.');
  if (u.port && u.port !== '443' && u.port !== '80') throw new FetchRefused('Only standard web ports are allowed.');
  if (isIP(u.hostname) || u.hostname === 'localhost' || u.hostname.endsWith('.local') || u.hostname.endsWith('.internal')) {
    throw new FetchRefused('Links to IP addresses or local hosts are not fetched.');
  }
  return u;
}

async function assertPublicHost(host: string) {
  const addrs = await lookup(host, { all: true }).catch(() => {
    throw new FetchRefused(`Could not find ${host}.`);
  });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new FetchRefused('That address points to a private network and was not fetched.');
}

/** DNS lookup that refuses private addresses, used for the connection itself (no rebinding gap). */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  lookupCb(hostname, { ...options, all: true }, (err, addresses) => {
    const list = addresses as unknown as LookupAddress[];
    if (err) return callback(err, '', 0);
    const bad = !list?.length || list.some((a) => isPrivateAddress(a.address));
    if (bad) return callback(Object.assign(new Error('private address'), { code: 'EPRIVATE' }), '', 0);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

interface GuardedResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: () => Promise<string>;
}

/** GET without following redirects, connecting only to public addresses. */
export function guardedGet(url: URL, accept: string, timeoutMs: number): Promise<GuardedResponse> {
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, lookup: guardedLookup, timeout: timeoutMs, agent: false }, (res) => {
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: () =>
          new Promise<string>((ok, fail) => {
            const chunks: Buffer[] = [];
            let total = 0;
            res.on('data', (c: Buffer) => {
              total += c.length;
              if (total > MAX_BYTES) {
                res.destroy();
                fail(new FetchRefused('The page is larger than 2 MB and was not read.'));
              } else chunks.push(c);
            });
            res.on('end', () => ok(Buffer.concat(chunks).toString('utf-8')));
            res.on('error', fail);
          }),
      });
    });
    req.on('timeout', () => req.destroy(new FetchRefused(`${url.hostname} took too long to respond.`)));
    req.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EPRIVATE' ? new FetchRefused('That address points to a private network and was not fetched.') : e instanceof FetchRefused ? e : new FetchRefused(`Could not reach ${url.hostname}.`)));
  });
}

/** Minimal robots.txt check for our user agent and "*". */
export function robotsAllows(robots: string, path: string, agent = 'householdfinancelistingreader'): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const line of robots.split(/\r?\n/)) {
    const clean = line.replace(/#.*/, '').trim();
    const m = clean.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      if (value || field === 'allow') current.rules.push({ allow: field === 'allow', path: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const group = specific ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best: { allow: boolean; path: string } | null = null;
  for (const r of group.rules) {
    if (!r.path) continue;
    const pattern = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (pattern.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}

/** Turn HTML into readable text, keeping line breaks between blocks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#36;|&dollar;/g, '$')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export async function fetchListing(raw: string): Promise<{ text: string; finalUrl: string }> {
  let url = validateUrl(raw);
  await assertPublicHost(url.hostname);

  // robots.txt: redirects aren't followed, and the same address checks apply.
  const robotsRes = await guardedGet(new URL('/robots.txt', url.origin), 'text/plain', 8_000).catch(() => null);
  if (robotsRes && robotsRes.status >= 200 && robotsRes.status < 300) {
    const robots = (await robotsRes.body().catch(() => '')).slice(0, 500_000);
    if (!robotsAllows(robots, url.pathname + url.search)) throw new FetchRefused(`${url.hostname} asks automated tools not to read this page (robots.txt), so it wasn't fetched. Copy the listing text from your browser and paste it instead.`);
  }

  for (let hop = 0; hop < 5; hop++) {
    const res = await guardedGet(url, 'text/html,application/xhtml+xml', 10_000);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.location;
      if (!loc) throw new FetchRefused('The site redirected without a destination.');
      url = validateUrl(new URL(loc, url).toString());
      await assertPublicHost(url.hostname);
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) throw new FetchRefused(`${url.hostname} blocked automated access (HTTP ${res.status}). This is common for listing sites. Copy the listing text from your browser and paste it instead.`);
    if (res.status < 200 || res.status >= 300) throw new FetchRefused(`${url.hostname} returned HTTP ${res.status}.`);
    const type = res.headers['content-type'] ?? '';
    if (!/text\/html|application\/xhtml/.test(type)) throw new FetchRefused('The link is not a web page.');
    const text = htmlToText(await res.body());
    if (text.length < 200) throw new FetchRefused('The page loaded but had almost no readable text (it probably needs JavaScript). Paste the listing text instead.');
    return { text: text.slice(0, 100_000), finalUrl: url.toString() };
  }
  throw new FetchRefused('Too many redirects.');
}
