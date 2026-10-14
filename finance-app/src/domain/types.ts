import type { Cents, FxTable } from './money';
import type { ISODate, MonthKey } from './dates';
import type { ScreenCriteria } from './property/screener';

export type PersonId = 'me' | 'partner';
export type Perspective = 'household' | PersonId;

/** Percentage ownership (0-100, up to 2 decimals). me + partner must equal 100. */
export interface Ownership {
  me: number;
  partner: number;
}

/**
 * Where a figure came from. Every balance, transaction and valuation carries one so the UI
 * can label it honestly.
 */
export type DataSource =
  | 'manual' // typed in by a person
  | 'csv' // imported from a CSV file the person supplied
  | 'mock' // the development mock open-banking provider (never real money)
  | 'sandbox' // a provider sandbox (test institution, never real money)
  | 'live' // a live open-banking (CDR) connection
  | 'statement' // read from a statement the person uploaded and confirmed
  | 'estimate' // calculated or estimated by the app
  | 'demo'; // the demo workspace

export type Visibility = 'shared' | 'private';

export type HoldingKind = 'asset' | 'liability';

export type AssetCategory =
  | 'transaction'
  | 'savings'
  | 'offset'
  | 'term-deposit'
  | 'cash'
  | 'shares-au'
  | 'shares-intl'
  | 'etf'
  | 'managed-fund'
  | 'super'
  | 'kiwisaver'
  | 'crypto'
  | 'property-home'
  | 'property-investment'
  | 'vehicle'
  | 'private-investment'
  | 'other-asset';

export type LiabilityCategory =
  | 'mortgage-owner'
  | 'mortgage-investment'
  | 'credit-card'
  | 'personal-loan'
  | 'car-loan'
  | 'bnpl'
  | 'help-debt'
  | 'family-loan'
  | 'other-liability';

export type HoldingCategory = AssetCategory | LiabilityCategory;

export type ValuationReason = 'opening' | 'manual-update' | 'revaluation' | 'sync' | 'import' | 'correction';

/** One point in a holding's value history. Doubles as the audit trail for balance changes. */
export interface ValuationEntry {
  id: string;
  /** The date the value applies to. */
  date: ISODate;
  /** Value in the holding's own currency, in cents. Liabilities are stored as positive balances owed. */
  valueCents: Cents;
  source: DataSource;
  reason: ValuationReason;
  note?: string;
  /** When this entry was recorded (ISO timestamp). */
  recordedAt: string;
  /** Who recorded it, if known (local-first mode records the active user). */
  recordedBy?: PersonId;
}

export interface LoanDetails {
  /** Annual interest rate as a fraction, e.g. 0.0614. */
  annualRate?: number;
  rateType?: 'variable' | 'fixed';
  fixedUntil?: ISODate;
  repaymentType?: 'PI' | 'IO';
  repaymentCents?: Cents;
  repaymentFrequency?: 'weekly' | 'fortnightly' | 'monthly';
  /** Contractual end date of the loan. */
  maturityDate?: ISODate;
  /** Linked offset account holding ids. */
  offsetAccountIds?: string[];
  /** For property loans: the property holding this loan is secured against. */
  securedByHoldingId?: string;
  creditLimitCents?: Cents;
}

export interface Holding {
  id: string;
  kind: HoldingKind;
  category: HoldingCategory;
  name: string;
  institution?: string;
  ownership: Ownership;
  visibility: Visibility;
  currency: string;
  /** Latest value in cents (own currency). null means "no value recorded". */
  valueCents: Cents | null;
  valuedAt: ISODate | null;
  source: DataSource;
  /** Present when the balance comes from an open-banking connection. */
  connectionId?: string;
  externalAccountId?: string;
  /** Last 4 digits / masked identifier used for reconciliation. Never a full account number. */
  maskedNumber?: string;
  availableCents?: Cents | null;
  lastSyncedAt?: string;
  notes?: string;
  history: ValuationEntry[];
  loan?: LoanDetails;
  /** For properties: expected rental income per month. */
  rentalIncomeMonthlyCents?: Cents;
  archived?: boolean;
  /**
   * Hosted mode only: a stand-in for the total of one partner's private items in a category,
   * built from the totals they chose to share. Never saved, never listed individually.
   */
  summaryOf?: PersonId;
  createdAt: string;
  updatedAt: string;
}

export type CategoryTreatment =
  | 'income' // money earned (salary, rent, interest)
  | 'expense' // consumption spending
  | 'transfer' // moving money between our own accounts
  | 'investment' // buying assets (shares, extra super) — not consumption
  | 'debt-repayment'; // repaying principal of a loan / card — not consumption

export interface Category {
  id: string;
  name: string;
  treatment: CategoryTreatment;
  /** Only meaningful for expenses. */
  essential?: boolean;
  fixed?: boolean;
  color: string;
  parentId?: string;
  builtin?: boolean;
  archived?: boolean;
}

export type TransferKind = 'none' | 'internal' | 'between-partners';

export type CategorisationSource = 'manual' | 'rule' | 'builtin-rule' | 'provider' | 'uncategorised';

export interface Transaction {
  id: string;
  date: ISODate;
  description: string;
  /** Signed cents from the account's point of view: positive = money in, negative = money out. */
  amountCents: Cents;
  currency: string;
  accountId: string | null;
  categoryId: string | null;
  subcategory?: string;
  merchant?: string;
  /** Override of the account's ownership for this transaction (e.g. a personal purchase on a joint card). */
  ownershipOverride?: Ownership;
  transfer: TransferKind;
  transferPairId?: string;
  recurring?: boolean;
  notes?: string;
  tags: string[];
  categorisation: { source: CategorisationSource; ruleId?: string; confidence: number };
  source: DataSource;
  externalId?: string;
  importBatchId?: string;
  pending?: boolean;
  /** Set when the reconciliation step thinks this may duplicate another transaction. */
  possibleDuplicateOf?: string;
  /** Excluded from all reports (e.g. confirmed duplicate kept for audit). */
  excluded?: boolean;
  createdAt: string;
}

export type RuleField = 'description' | 'merchant';
export type RuleOp = 'contains' | 'startsWith' | 'equals' | 'regex';

export interface CategoryRule {
  id: string;
  name: string;
  field: RuleField;
  op: RuleOp;
  value: string;
  direction?: 'in' | 'out';
  minAmountCents?: Cents;
  maxAmountCents?: Cents;
  accountId?: string;
  setCategoryId: string;
  setTransfer?: TransferKind;
  setMerchant?: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
  matchCount?: number;
}

export interface BudgetLine {
  id: string;
  categoryId: string;
  scope: Perspective;
  monthlyCents: Cents;
  rollover: boolean;
  /** Month from which rollover accumulates. */
  startMonth: MonthKey;
}

export interface PlannedExpense {
  id: string;
  name: string;
  date: ISODate;
  amountCents: Cents;
  categoryId: string | null;
  scope: Perspective;
  done?: boolean;
}

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually';

export interface RecurringBill {
  id: string;
  name: string;
  amountCents: Cents;
  frequency: Frequency;
  nextDate: ISODate;
  categoryId: string | null;
  accountId: string | null;
  scope: Perspective;
  kind: 'bill' | 'subscription' | 'income';
  /** Matching pattern used to recognise payments of this bill in transactions. */
  matchText?: string;
  active: boolean;
}

export type PayFrequency = 'weekly' | 'fortnightly' | 'monthly';

export type Residency = 'resident' | 'non-resident' | 'unknown';

export interface IncomeProfile {
  /** Gross annual salary in cents. If packageIncludesSuper, this is the total package. */
  salaryCents: Cents;
  packageIncludesSuper: boolean;
  /** Employer super rate override (fraction). Defaults to the ruleset's SG rate. */
  superRate?: number;
  bonusAnnualCents: Cents;
  /** Whether the bonus counts as ordinary time earnings (attracts SG). */
  bonusAttractsSuper: boolean;
  otherTaxableIncomeAnnualCents: Cents;
  payFrequency: PayFrequency;
  /** Month (1-12) of the annual salary review. */
  reviewMonth: number;
  expectedAnnualIncrease: number;
  salarySacrificeAnnualCents: Cents;
  deductionsAnnualCents: Cents;
  hasHelpDebt: boolean;
  residency: Residency;
  privateHospitalCover: boolean;
  employer?: string;
  notes?: string;
}

export interface Person {
  id: PersonId;
  name: string;
  income: IncomeProfile;
  dateOfBirth?: ISODate;
}

export type GoalType =
  | 'home-deposit'
  | 'emergency-fund'
  | 'mortgage-reduction'
  | 'investment'
  | 'retirement'
  | 'holiday'
  | 'car'
  | 'parental-leave'
  | 'debt-repayment'
  | 'net-worth'
  | 'other';

export interface Goal {
  id: string;
  name: string;
  type: GoalType;
  targetCents: Cents;
  targetDate: ISODate;
  /** Manual progress, used when no holdings are linked. */
  currentCents: Cents;
  /** If set, progress = sum of these holdings' attributed values (or liabilities paid down). */
  linkedHoldingIds: string[];
  /** For debt goals linked to liabilities: the balance owed when the goal was set. */
  baselineCents?: Cents;
  monthlyContributionCents: Cents;
  expectedReturn: number;
  priority: 1 | 2 | 3 | 4 | 5;
  scope: Perspective;
  createdAt: string;
  notes?: string;
}

export interface NetWorthTotals {
  assetsCents: Cents;
  liabilitiesCents: Cents;
  netWorthCents: Cents;
  liquidCents: Cents;
  investableCents: Cents;
  propertyEquityCents: Cents;
  superCents: Cents;
}

export interface NetWorthSnapshot {
  id: string;
  date: ISODate;
  recordedAt: string;
  kind: 'recorded' | 'reconstructed';
  household: NetWorthTotals;
  me: NetWorthTotals;
  partner: NetWorthTotals;
  /** Share of holdings that had a value on this date (reconstructed snapshots). */
  coverage?: number;
}

export type ConnectionStatus = 'pending' | 'active' | 'syncing' | 'expired' | 'error' | 'revoked';

export interface BankConnection {
  id: string;
  provider: 'mock' | 'basiq';
  environment: 'mock' | 'sandbox' | 'live';
  institutionId: string;
  institutionName: string;
  owner: PersonId;
  status: ConnectionStatus;
  consentGrantedAt?: string;
  consentExpiresAt?: string;
  scopes: string[];
  /** Visibility given to accounts this connection discovers for the first time. */
  newAccountVisibility?: Visibility;
  lastSyncAt?: string;
  lastSyncResult?: { ok: boolean; message: string; at: string; added?: number; duplicates?: number };
  createdAt: string;
}

export interface InsightState {
  dismissed: Record<string, string>; // insight id -> dismissed at
}

export interface Assumptions {
  inflation: number;
  salaryGrowth: number;
  investmentReturn: number;
  investmentFees: number;
  investmentTaxDrag: number;
  superReturn: number;
  cashRate: number;
  propertyGrowth: number;
  mortgageRateDelta: number;
  livingCostGrowth: number;
  vehicleDepreciation: number;
  emergencyFundMonths: number;
  /** Share of surplus (after the emergency fund target is met) that is invested. */
  surplusInvestShare: number;
}

export type ScenarioEvent =
  | { id: string; type: 'salary-change'; person: PersonId; date: ISODate; mode: 'set' | 'percent'; value: number; label?: string }
  | { id: string; type: 'bonus-change'; person: PersonId; date: ISODate; bonusAnnualCents: Cents }
  | { id: string; type: 'hours-change'; person: PersonId; start: ISODate; end?: ISODate; fte: number }
  | {
      id: string;
      type: 'parental-leave';
      person: PersonId;
      start: ISODate;
      totalWeeks: number;
      employerPaidWeeks: number;
      govPaidWeeks: number;
      govWeeklyCents: Cents;
      returnFte: number;
    }
  | { id: string; type: 'income-stop'; person: PersonId; start: ISODate; end?: ISODate; label?: string }
  | { id: string; type: 'rental-income'; start: ISODate; end?: ISODate; monthlyCents: Cents; ownership: Ownership }
  | { id: string; type: 'living-cost-change'; start: ISODate; end?: ISODate; monthlyDeltaCents: Cents; label?: string }
  | { id: string; type: 'child'; date: ISODate; monthlyCostCents: Cents }
  | { id: string; type: 'large-expense'; date: ISODate; amountCents: Cents; label: string }
  | { id: string; type: 'super-change'; person: PersonId; date: ISODate; salarySacrificeAnnualCents: Cents }
  | {
      id: string;
      type: 'property-purchase';
      date: ISODate;
      priceCents: Cents;
      depositCents: Cents;
      costsCents: Cents;
      rate: number;
      termYears: number;
      /** Rent that stops once we move in (owner-occupier purchase). */
      rentSavedMonthlyCents?: Cents;
      label?: string;
    };

export type ScenarioEventType = ScenarioEvent['type'];

export interface Scenario {
  id: string;
  name: string;
  preset: 'base' | 'optimistic' | 'conservative' | 'custom';
  assumptions: Assumptions;
  events: ScenarioEvent[];
  /** Monthly consumption spending at the start of the forecast. null = derive from data. */
  livingCostsMonthlyCents: Cents | null;
  horizonYears: number;
  createdAt: string;
  updatedAt: string;
  color: string;
}

export type FieldStatus = 'extracted' | 'user' | 'estimated' | 'unavailable';

export interface ListingField<T = string | number | null> {
  value: T;
  status: FieldStatus;
  /** For extracted fields, the snippet of listing text that produced the value. */
  evidence?: string;
}

export type AustralianState = 'VIC' | 'NSW' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';

export interface PropertyListing {
  address: ListingField<string | null>;
  suburb: ListingField<string | null>;
  state: ListingField<AustralianState | null>;
  postcode: ListingField<string | null>;
  propertyType: ListingField<string | null>;
  priceCents: ListingField<number | null>;
  priceMaxCents: ListingField<number | null>;
  priceText: ListingField<string | null>;
  bedrooms: ListingField<number | null>;
  bathrooms: ListingField<number | null>;
  parking: ListingField<number | null>;
  landSizeSqm: ListingField<number | null>;
  strataAnnualCents: ListingField<number | null>;
  councilRatesAnnualCents: ListingField<number | null>;
  waterAnnualCents: ListingField<number | null>;
  rentWeeklyCents: ListingField<number | null>;
  leaseDetails: ListingField<string | null>;
}

export interface PropertyPurchaseSettings {
  buyers: 'joint' | 'me' | 'partner' | 'custom';
  ownership: Ownership;
  intendedUse: 'owner-occupier' | 'investment';
  firstHomeBuyer: boolean;
  homeGuarantee: boolean;
  depositCents: Cents;
  interestRate: number;
  termYears: number;
  repaymentType: 'PI' | 'IO';
  conveyancingCents: Cents;
  inspectionsCents: Cents;
  movingCents: Cents;
  furnishingCents: Cents;
  buildingInsuranceAnnualCents: Cents;
  maintenanceRate: number;
  lmiOverrideCents: Cents | null;
  capitaliseLmi: boolean;
  stressBuffer: number;
  emergencyFundMonths: number;
  /** Optional overrides of household profile values for this analysis. */
  overrides: {
    takeHomeMonthlyCents?: Cents | null;
    livingCostsMonthlyCents?: Cents | null;
    savingsCents?: Cents | null;
    otherDebtRepaymentsMonthlyCents?: Cents | null;
  };
  currentRentWeeklyCents: Cents | null;
  stampDutyOverrideCents: Cents | null;
}

export interface PropertyAnalysis {
  id: string;
  name: string;
  sourceUrl?: string;
  rawText: string;
  fetchStatus?: { ok: boolean; message: string; at: string };
  listing: PropertyListing;
  settings: PropertyPurchaseSettings;
  shortlisted: boolean;
  notes?: string;
  /** Door-to-door commute in minutes, entered by the household (used by the screener). */
  commuteMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  by?: PersonId;
  action: string;
  detail: string;
}

export interface Settings {
  baseCurrency: 'AUD';
  fx: FxTable;
  theme: 'dark' | 'light' | 'system';
  /** Who is using this device right now (display control in local mode, not security). */
  activeUser: PersonId;
  /** Per-person consent to include their private items' values in household totals. */
  shareTotalsOfPrivateItems: Record<PersonId, boolean>;
  /** Days after which a balance from each source is considered stale. */
  staleDays: { synced: number; manualCash: number; manualInvestment: number; property: number; other: number };
  stateOfResidence: AustralianState;
  defaultAssumptions: Assumptions;
  taxYearOverride?: string;
  onboarded: boolean;
  autoSnapshot: boolean;
  /** House screener criteria, shared by both partners. */
  screener?: ScreenCriteria;
}

export interface WorkspaceData {
  schemaVersion: number;
  kind: 'real' | 'demo';
  people: Record<PersonId, Person>;
  holdings: Holding[];
  transactions: Transaction[];
  categories: Category[];
  rules: CategoryRule[];
  budgets: BudgetLine[];
  plannedExpenses: PlannedExpense[];
  bills: RecurringBill[];
  goals: Goal[];
  snapshots: NetWorthSnapshot[];
  scenarios: Scenario[];
  properties: PropertyAnalysis[];
  connections: BankConnection[];
  insights: InsightState;
  audit: AuditEntry[];
  settings: Settings;
}
