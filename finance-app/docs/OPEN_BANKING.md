# Open banking (Consumer Data Right)

## What this build does

- **Reads only.** Accounts, balances and transactions come in through a provider adapter on the local server. Nothing can move money, make payments or trade.
- **Never handles bank credentials.** Consent happens on the provider's own consent screen. No screen in this app has a bank password field.
- **Keeps provider secrets on the server.** API keys come from the server's environment. The browser receives consent URLs and sync results only.
- **Labels data honestly.** Every synced balance and transaction carries its source: `mock`, `sandbox` or `live`. Mock and sandbox data show a badge and are never presented as real.
- **Makes no accreditation claim.** This app is not an accredited data recipient.

## Providers

| Provider | Status | Use |
|---|---|---|
| `mock` | Built in, on in development | Fictional banks that simulate healthy, expired-consent, failing and duplicate-sending feeds. Off in production unless `ENABLE_MOCK_PROVIDER=true`. |
| `basiq` | Adapter written, needs a key | Basiq is an accredited CDR data recipient offering an intermediary service. Set `BASIQ_API_KEY` and `BASIQ_ENVIRONMENT=sandbox` to use its test banks. |

The Basiq adapter (`server/providers/basiq.ts`) follows Basiq's v3 API:

1. Get a server token.
2. Create one Basiq user per person.
3. Get a client token, which leads to the `consent.basiq.io` consent URL.
4. Read accounts and paginated transactions.

The adapter has **not** been run against Basiq's live sandbox from this environment, so verify each endpoint against the current Basiq docs with a sandbox key before relying on it.

Adding another provider means implementing `ProviderAdapter` in `server/providers/types.ts`.

## Flow

1. **Settings → Connections → Connect a bank.** The person using the app is the consenting account holder, and their partner connects their own accounts. They choose who can see new accounts: shared, or private to them.
2. The server starts consent and stores the provider-side ids in an AES-256-GCM vault (`server/.data/connections.enc`).
3. Consent happens next:
   - **Basiq:** the consent page opens in a new tab.
   - **Mock:** an in-app screen, clearly marked as a simulation, lists the data shared and the 90-day duration.
4. **Sync** maps provider data into the workspace with `applySync` (`src/domain/openBanking.ts`):
   - New accounts are owned 100% by the consenting person.
   - Existing accounts keep your edits (name, ownership split, visibility); only the balance and history are refreshed.
   - Transactions are de-duplicated by provider id. Suspected duplicates are flagged in Transactions → Reconcile.
5. **Failures change nothing** except the connection's status line:
   - an expired consent marks the connection **expired** and asks you to reconnect;
   - a provider error marks it **error**.
6. **Disconnect** revokes consent at the provider (for Basiq, it deletes the Basiq user and their data). You then choose whether to keep the synced history or delete it.

## Before using live data

1. **Legal basis.** You need a production agreement with an accredited intermediary under a CDR representative or outsourced service arrangement, or your own accreditation. For personal use, the intermediary's terms decide what is allowed.
2. **Consent records.** The provider holds the authoritative consent record. Keep its dashboard as the source of truth for consent expiry and withdrawal.
3. **Retention.** The CDR rules require deleting or de-identifying CDR data when consent expires or is withdrawn, unless an exception applies. Choose **Delete synced accounts and transactions** when disconnecting, or decide on a retention policy and document it.
4. **Deployment.** Set `SERVER_ENCRYPTION_KEY`. Keep the server on `127.0.0.1` or behind an identity provider (see SECURITY.md). Use HTTPS and set `PUBLIC_URL` so the consent return and origin checks match.
5. **Testing.** Exercise each failure mode (expired consent, provider errors, re-syncs, duplicates) with sandbox institutions before connecting a real bank.
