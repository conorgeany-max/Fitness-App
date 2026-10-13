# Security and privacy

## Model

This app is built for one household on one computer.

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

## No home-made authentication

The app has no login system on purpose. Password storage, sessions and recovery are easy to get wrong.

To reach the app from anywhere other than the machine it runs on:

1. Put it behind an **identity-aware proxy or OIDC provider**. Examples: Cloudflare Access, Tailscale with ACLs, oauth2-proxy with Google or Microsoft accounts, or Auth0. Allow exactly two identities.
2. Serve it over HTTPS, set `PUBLIC_URL`, and keep `HOST=127.0.0.1` behind the proxy.
3. For per-partner separation enforced by the server, workspace data would need to move server-side with per-user keys. That is not built.

## Backups

JSON exports are **not encrypted**. Store them somewhere you trust, or encrypt them yourself.

**Delete all data** in Settings does three things:
- revokes every bank connection;
- removes both workspaces from the browser;
- removes the encryption settings.

## Reporting

This is a personal project. If you find a problem, fix it on a branch and run `npm run check`.
