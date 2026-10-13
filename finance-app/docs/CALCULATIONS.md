# Calculations and conventions

Every formula lives in `src/domain/` as a pure function with unit tests in `src/domain/__tests__/`. This page summarises the conventions; the source comments carry the detail.

## Money

- Stored amounts are **integer cents** in the amount's own currency.
- Intermediate maths (interest, growth, tax) may use floating point. Anything stored, summed or displayed is rounded to whole cents with `roundCents`, which rounds half away from zero.
- Splitting a total between people uses the **largest-remainder method**, so the parts always add back to the total.
- Foreign-currency holdings are converted with rates you enter in Settings. A holding without a rate is excluded from totals and flagged; it is never treated as AUD.

## Net worth (`networth.ts`, `history.ts`)

- Net worth = total assets − total liabilities.
- **Household** view: each item is counted once at full value.
- **Individual** views: each item is weighted by that person's ownership (for assets) or responsibility (for liabilities). Me + partner = household for the same set of items.
- **Private items:** the owner sees them in full. The partner sees them only inside totals, and only when the owner has opted in; otherwise they are excluded from the partner's figures.
- **History:**
  - Recorded snapshots are taken monthly or on demand.
  - Reconstructed points are estimated from each holding's valuation history and labelled as estimates.
  - Coverage shows the share of holdings that had a value at that date.
- **Change attribution** splits the change between two dates into:
  - cash movements;
  - investment contributions, from categorised transactions;
  - super;
  - property revaluations;
  - debt repaid;
  - other revaluations;
  - new items.

## Transactions and cash flow (`transactions.ts`, `budget.ts`)

- **Income** is the sum of categories with income treatment. **Consumption spending** is the sum of expense categories; refunds reduce spending.
- **Transfers:**
  - Transfers between your own accounts are excluded from income and spending.
  - Partner-to-partner transfers are excluded from household figures. Individual views show them as transfers to or from the partner.
- Investment purchases and principal repayments are cash outflows but **not consumption**.
- **Savings rate** = (income − consumption) / income.
- **Duplicates:**
  - The same provider id, or the same account, date, amount and normalised description as an existing transaction, is skipped.
  - Repeats within one import are kept but flagged for review.
  - The same account and amount within ±3 days is flagged as a possible duplicate.
- **Budgets:**
  - Actuals use signed amounts, so refunds count against spending.
  - Fixed categories project to max(actual, budget); variable categories project linearly by days elapsed.
  - Rollover carries unspent or overspent amounts forward from the budget's start month.

## Tax (`tax/tax.ts`, `tax/salary.ts`)

- **Included:** resident and foreign-resident marginal rates, LITO, the Medicare levy with its low-income shade-in, an optional Medicare levy surcharge, and HELP compulsory repayments. These come from the rule set for the financial year (see RULESETS.md).
- **Packages that include super** are converted to a base salary as package / (1 + SG rate), capped at the maximum contribution base. Employer super is never spendable income.
- **Not modelled** (also disclosed in the UI): other offsets, family Medicare reductions, capital gains, franking credits, Division 293 and PAYG timing.

## Forecast (`forecast.ts`)

The forecast runs on a monthly time step:

1. Pay is calculated for each person, applying salary reviews, part-time work, leave, income stops and bonuses.
2. Tax is applied on an annualised basis with that year's rule set. Future years carry the latest rule set forward without indexation, which is conservative.
3. Employer super and salary sacrifice go to super, less 15% contributions tax.
4. Cash receives net pay and rent, and pays indexed living costs, loan repayments and one-off events.
5. Any surplus first fills the emergency fund target, then is split between investments and cash. A deficit draws on cash, then investments.
6. Balances then grow:
   - investments at return less fees and tax drag;
   - super, cash interest and property growth;
   - vehicles depreciate;
   - loans amortise with interest on the balance less any offset.

**Real dollars** divide by (1 + inflation)^years.

**Sensitivity** re-runs the forecast with each assumption moved up and down, and reports the change in final net worth.

## Mortgages and debts (`mortgage.ts`, `debt.ts`)

- The periodic rate is the annual rate divided by periods per year. Lenders accrue daily, so real statements will differ slightly.
- The repayment is the standard annuity payment, rounded up to the cent. Interest is charged on (balance − offset).
- Extra repayments and offset balances shorten the term. The final repayment closes the loan at exactly $0.
- **Accelerated** fortnightly or weekly repayments are half or a quarter of the monthly amount, which equals 13 monthly repayments a year.
- At the end of an interest-only period or introductory rate, repayments are recalculated over the remaining term.
- **Debt planner:**
  - Avalanche pays the highest rate first; snowball pays the smallest balance first.
  - Minimum payments always go to every debt.
  - Freed-up minimums roll into the target debt.

## Compound growth (`compound.ts`)

- Calculated monthly, with three compounding conventions: monthly nominal, annual effective and annual credit.
- Fees (% p.a.) and tax on positive earnings reduce growth.
- Contributions are made at the start or end of each period.
- Growth = final balance − starting balance − contributions.

## Property affordability (`property/affordability.ts`)

This is a cash-flow analysis, **not** a lender serviceability assessment.

**Upfront costs** include:
- the deposit;
- stamp duty from the state rule set;
- registration fees;
- an LMI estimate above 80% LVR;
- conveyancing and inspections.

**Ongoing costs** cover the repayment, strata, council, water, insurance and maintenance. Investment purchases add rent less vacancy (4%) and management fees (7%).

**Checks**, with their default thresholds:

| Check | Comfortable | Stretched or fail |
|---|---|---|
| Cash to settle | savings cover it | shortfall |
| Monthly surplus after purchase | positive | negative |
| Surplus at rate + stress buffer | positive | negative |
| Housing cost / take-home pay | ≤ 30% | > 40% |
| Emergency buffer after settlement | ≥ 6 months of essentials | < 3 months |
| LVR | ≤ 90% | above 90% caps the label at "manageable" |

- The **label** follows from these checks, and the UI lists every reason behind it.
- **Missing inputs** (price, rent, fees) block a label rather than being guessed.
- When a price range is given, the **upper end** is used.

**Rent vs buy** compares the buyer's equity with a renter who invests the deposit and any monthly difference. It ignores selling costs, CGT and tax on returns, and says so.

## Goals and tools (`goals.ts`, `tools.ts`)

- **Required monthly contribution** solves the annuity future-value equation at the assumed return. A 0% return falls back to the straight-line amount.
- **Options for a goal behind schedule:** save more, extend the date, or invest at the scenario return. Debt goals never get the invest option.
- **Parental leave:**
  - Employer weeks are paid at the salary rate.
  - Government weeks are paid at the rate you enter.
  - The gap equals spending during leave minus income during leave.
