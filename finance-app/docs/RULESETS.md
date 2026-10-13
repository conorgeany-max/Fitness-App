# Rule sets

Tax, super and stamp duty figures are data, not code paths. Each rule set has an id, an effective period, a status and official sources. The Settings page, under **Rules & sources**, lists them with links.

## Status

- **Confirmed**: published for that period and checked against the source.
- **Provisional**: legislated but not yet published, or carried forward. Wherever a provisional rule set feeds a result, the UI shows a warning.

## Income tax, Medicare, HELP, super (`src/domain/tax/rulesets.ts`)

| Financial year | Status | Notes |
|---|---|---|
| 2025-26 | Confirmed | |
| 2026-27 | Provisional | 15% bottom rate legislated. Medicare thresholds carried forward until the ATO publishes them. |
| 2027-28 | Provisional | 14% bottom rate legislated. Other thresholds carried forward. |

`rulesetForFinancialYear(fy)` returns the exact rule set, or the latest earlier one with `exact: false`. The UI then says which year's rules were used. Forecasts carry the latest rule set forward without indexing it.

**Annual update (each July):**

1. Copy the latest entry and update its `financialYear`, `startDate` and `endDate`.
2. Update the brackets, LITO, Medicare thresholds and surcharge tiers, HELP tiers, SG rate, concessional cap and maximum contribution base from the ATO pages listed in `sources`.
3. Set `status` and `verifiedOn`. Add a `statusNote` for anything still unconfirmed.
4. Add a test case in `src/domain/__tests__/tax.test.ts` against a published ATO example.
5. Run `npm run check`.

## Stamp duty (`src/domain/property/stampDuty.ts`)

| State | Rule set | Status | Concessions modelled |
|---|---|---|---|
| VIC | VIC-2025-07 | Confirmed | PPR, first home buyer exemption and concession |
| NSW | NSW-2026-07 | Provisional (indexed thresholds) | First Home Buyers Assistance |
| QLD | QLD-2025-05 | Provisional | Home concession, first home (including new homes) |
| WA, SA, TAS, ACT, NT | none | Not configured | |

States without a rule set return `supported: false` and the analyser asks for your own estimate. One state's rates are never applied to another state.

Not modelled anywhere: foreign purchaser surcharges, off-the-plan concessions, pensioner concessions and grants. The UI lists these as items to confirm.

## Other assumptions

The following are user-editable assumptions, not rule sets:

- inflation, returns, property growth and rent growth are stored in each scenario;
- the stress buffer, LMI and conveyancing are stored in each property analysis.

The forecast presets are `PRESET_ASSUMPTIONS` in `src/domain/forecast.ts`. Property purchase defaults are in `defaultPurchaseSettings()`.
