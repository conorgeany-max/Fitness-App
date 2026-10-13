/**
 * Fetch a public listing page's text for the property analyser.
 *
 * Guard rails:
 * - https/http only, standard ports, no credentials in the URL.
 * - The host must resolve only to public addresses (blocks localhost, private, link-local,
 *   carrier-grade NAT and metadata ranges), checked again on every redirect (SSRF).
 * - robots.txt is honoured for our user agent; if it disallows the path we don't fetch.
 * - 10 second timeout, 2 MB cap, HTML only. No cookies, no JavaScript execution.
 * Failures are reported as they are; the browser then asks the person to paste the text.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff')) return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
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

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new FetchRefused('The page is larger than 2 MB and was not read.');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
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

  const robotsRes = await fetch(`${url.origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (robotsRes?.ok) {
    const robots = (await robotsRes.text()).slice(0, 500_000);
    if (!robotsAllows(robots, url.pathname + url.search)) throw new FetchRefused(`${url.hostname} asks automated tools not to read this page (robots.txt), so it wasn't fetched. Copy the listing text from your browser and paste it instead.`);
  }

  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new FetchRefused('The site redirected without a destination.');
      url = validateUrl(new URL(loc, url).toString());
      await assertPublicHost(url.hostname);
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) throw new FetchRefused(`${url.hostname} blocked automated access (HTTP ${res.status}). This is common for listing sites. Copy the listing text from your browser and paste it instead.`);
    if (!res.ok) throw new FetchRefused(`${url.hostname} returned HTTP ${res.status}.`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/.test(type)) throw new FetchRefused('The link is not a web page.');
    const text = htmlToText(await readCapped(res));
    if (text.length < 200) throw new FetchRefused('The page loaded but had almost no readable text (it probably needs JavaScript). Paste the listing text instead.');
    return { text: text.slice(0, 100_000), finalUrl: url.toString() };
  }
  throw new FetchRefused('Too many redirects.');
}
