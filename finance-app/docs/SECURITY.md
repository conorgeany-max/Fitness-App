# Security and privacy

## Two ways to run it

- **Local version** (`npm run dev` / `npm start`): one household on one computer. Described in the first sections below.
- **Hosted version** (Supabase + Vercel, [DEPLOY.md](DEPLOY.md)): each partner signs in separately from any device. Described under **Hosted version**.

## Local version

| Layer | Protection |
|---|---|
| Workspace data (browser) | IndexedDB. Optional passphrase encryption: AES-256-GCM with a key derived via PBKDF2-SHA-256, 600,000 iterations and a random salt. The passphrase is never stored; losing it means losing the data. |
| Local API server | Binds to `127.0.0.1`. Same-origin check on `/api`, rate limits and a 64 KB body limit. In production it adds a strict CSP and security headers. |
| Provider secrets | Server environment only. Never in the bundle, the browser or the logs. |
| Connection ids | Provider user and connection ids sit in an AES-256-GCM vault keyed by `SERVER_ENCRYPTION_KEY`, which is required in production. |
| Bank credentials | Never requested or handled. Consent happens on the provider's site. |
| Money movement | None. All provider access is read-only. |
| Listing fetcher | http and https only, on standard ports. Rejects private, loopback and metadata addresses, and re-checks each redirect. Honours robots.txt. 2 MB cap, timeouts, no cookies and no JavaScript. |
| Audit | Imports, syncs, balance changes, connection changes and restores are logged in the workspace. |

## Partner privacy

- Each item is **shared** or **private**. A private item must be solely owned.
- The owner sees their private items in full.
- The other partner sees them only inside totals, and only when the owner has switched on **include private items in household totals**. Otherwise they are left out of everything that partner sees.
- Only the owner can change their own consent, while they are the active user.

**Limitation.** On a shared device in local mode, "who is using the app" is a display control. Anyone with the browser profile (and the passphrase, if one is set) can switch users. For real separation, each partner should use their own browser profile or device, or the app should be deployed with per-user sign-in as described below.

## Hosted version

| Layer | Protection |
|---|---|
| Sign-in | Supabase Auth: email and password (12+ characters) plus a TOTP authenticator code. No home-made password handling. Lost authenticators are reset by the Supabase project owner, not by email. |
| Database access | Postgres row level security. Every policy requires a two-factor (`aal2`) session, so a stolen password alone reads nothing. |
| Partner separation | Enforced by the database, not the app. Each person's private document, private accounts and transactions are readable only by them. The partner sees a person's private items only through `private_summaries`, which holds totals the owner chose to share. |
| Provider tokens | Up tokens and SnapTrade keys are encrypted with AES-256-GCM (`SERVER_ENCRYPTION_KEY`) before storage. Token columns are never granted to browser sessions; only the server, with the service role key, can read them. |
| Server secrets | `SUPABASE_SERVICE_ROLE_KEY`, `SERVER_ENCRYPTION_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY` and Domain credentials live only in Vercel's environment. The browser bundle contains only the Supabase URL and anon key, which are public by design. |
| Webhooks and cron | Up webhooks are checked with HMAC-SHA256 against a per-connection secret. The daily sync requires `CRON_SECRET`. |
| Headers | `vercel.json` sets a strict CSP (scripts from the site only; connections only to Supabase), HSTS, `frame-ancestors 'none'`, nosniff and no-referrer. API responses are `no-store`. |
| Money movement | None. Up's personal token can also change a transaction's category and tags, but it cannot move money; this app never calls those endpoints. SnapTrade is used read-only and never places trades. |
| AI assistant | Off until each person turns it on. It receives only computed totals the person can already see, has no tools, and every number in its answer is inserted by the server from those totals. A household monthly ceiling (default A$10) is checked before each call. |
| Account deletion | Settings → Data → Delete my account disconnects the person's providers, deletes their private data, their membership and their login. |

## No home-made authentication

The local version has no login system on purpose; the hosted version uses Supabase Auth. Password storage, sessions and recovery are easy to get wrong.

To reach the local version from anywhere other than the machine it runs on, put it behind an **identity-aware proxy or OIDC provider** (Cloudflare Access, Tailscale with ACLs, oauth2-proxy) allowing exactly two identities, serve it over HTTPS, set `PUBLIC_URL`, and keep `HOST=127.0.0.1`. Or use the hosted version.

## Backups

JSON exports are **not encrypted**. Store them somewhere you trust, or encrypt them yourself.

**Delete all data** in Settings does three things:
- revokes every bank connection;
- removes both workspaces from the browser;
- removes the encryption settings.

## Reporting

This is a personal project. If you find a problem, fix it on a branch and run `npm run check`.
