# Ledgerline: household finance

A private finance and wealth app for two partners. It shows net worth, cash flow, budgets, forecasts, property affordability and goals from three views: each partner's own view and the combined household view. Every figure is labelled with whose it is (individual or combined) and where it came from (manual, CSV, mock, sandbox, live, estimate or forecast).

It is local-first. The workspace lives in your browser's IndexedDB, with optional passphrase encryption. A small local API server holds open-banking provider keys and fetches public listing pages. The app never sees bank passwords, and it cannot move money, make payments or trade.

> Calculations are educational estimates, not financial, tax or credit advice.

## Quick start

```bash
cd finance-app
npm install
npm run dev          # web on http://localhost:5173, API on http://127.0.0.1:8787
```

Open the app and choose **Explore demo mode** to see it filled with fictional data, or set up your own household. The demo workspace is kept separate from your real one.

Bank connections work out of the box with the **mock provider**, which offers fictional banks that simulate healthy, expired-consent, failing and duplicate-sending feeds. To try the Basiq sandbox, copy `.env.example` to `.env` and set `BASIQ_API_KEY` (see [docs/OPEN_BANKING.md](docs/OPEN_BANKING.md)).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server and API server with reload |
| `npm run check` | Typecheck, lint, tests and production build (run before committing) |
| `npm test` | Unit tests (Vitest) for every formula, the sync mapper and server guards |
| `npm run build` | Production bundle in `dist/` |
| `npm start` | Production mode: the API server serves `dist/` with a strict CSP. Requires `SERVER_ENCRYPTION_KEY`. |

Requires Node 20.12 or newer.

## What's in it

- **Home**: net worth, monthly cash flow, upcoming bills, goals, data health and traceable insights. Insights come from deterministic rules with their evidence, never a language model.
- **Net worth**:
  - Assets and liabilities with individual, joint or custom ownership splits, counted once in household totals.
  - Valuation history, recorded and reconstructed snapshots, and change attribution.
  - Staleness flags and foreign-currency holdings.
- **Transactions & budget**:
  - CSV import with column mapping, plus manual entry.
  - Categorisation rules, transfer and duplicate reconciliation.
  - Budgets with rollover, planned expenses, recurring bills and detected subscriptions.
- **Forecasts**:
  - 1–30 year monthly projection in nominal or real dollars.
  - Per-person income and tax using versioned Australian rules.
  - Life-event scenarios, comparison and sensitivity.
- **Property & mortgages**:
  - Listing analyser for a URL or pasted text, with a status per field and no invented data.
  - Affordability against your real finances, with transparent labels.
  - Shortlist, mortgage and refinance calculator, debt planner, stamp duty.
- **Financial tools**: goals with allocation trade-offs and 11 calculators (compound growth, emergency fund, take-home pay, promotion, savings goal, deposit, rent vs buy, inflation, retirement, cash flow, parental leave).
- **Settings**:
  - Household profiles and privacy sharing consent.
  - Bank connections and backup/restore.
  - Passphrase encryption, delete everything.
  - Staleness and exchange rates, rule sets with sources, and the audit log.

## Architecture

```
finance-app/
  src/
    domain/        Pure, typed calculation modules (integer cents) and their tests
      tax/         Versioned tax/super rule sets and take-home pay
      property/    Listing parser, affordability, stamp duty
      openBanking.ts  Shapes shared with the server + sync → workspace mapping
    store/         Zustand store, persistence (IndexedDB, AES-GCM), derived data, demo seed
    components/    UI kit, finance badges, chart helpers
    pages/         One folder per area
  server/
    index.ts       Local API (Node http): providers, consent, sync, listing fetch, static serving
    providers/     Provider adapters: mock, Basiq
    vault.ts       Encrypted store for provider-side connection ids
    listing.ts     SSRF-guarded, robots.txt-respecting listing fetcher
  docs/            Calculations, rule sets, open banking, security
```

**Key principles**

- **Money is integers.** Every amount is stored in cents. Model maths may use floats internally, but anything stored, summed or shown is rounded back to cents. Splits use the largest-remainder method, so partner shares add up exactly to the household figure.
- **Pure domain code.** Each formula is a pure function with tests. The UI only formats and labels.
- **Honest labelling.** Every balance carries a source. Mock and sandbox data can never look like live data, and forecasts and estimates are marked as such.
- **Privacy model.** Private items belong to one person. The other partner sees them only as part of totals, and only when the owner has opted in; otherwise they are left out. See [docs/SECURITY.md](docs/SECURITY.md) for what this does and does not protect.

## Documentation

- [docs/CALCULATIONS.md](docs/CALCULATIONS.md): formulas and conventions
- [docs/RULESETS.md](docs/RULESETS.md): tax and duty rule sets, and how to update them each year
- [docs/OPEN_BANKING.md](docs/OPEN_BANKING.md): CDR connections and what a live deployment needs
- [docs/SECURITY.md](docs/SECURITY.md): threat model, encryption, deployment

## Outstanding before real-world use

1. **Live bank data.** You need a production agreement with an accredited provider, such as Basiq, or your own CDR accreditation or representative arrangement. The adapter is written against Basiq's v3 API but has only been exercised against the mock provider here. Verify the endpoints against the sandbox first.
2. **Authentication.** There are no app accounts by design. To use the app anywhere but your own computer, put it behind an identity provider (OIDC) as described in docs/SECURITY.md.
3. **Rule sets.** The 2026-27 and later tax rule sets, and NSW and QLD duty, are marked provisional. Confirm them against the ATO and state revenue offices when published. Stamp duty for WA, SA, TAS, ACT and NT is not configured yet.
4. **Property data.** No market data source is integrated. Valuations, rents and comparable sales are whatever you enter, labelled as such.
