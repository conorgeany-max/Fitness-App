/**
 * Versioned Australian personal tax and superannuation rules.
 *
 * Every figure is tied to a financial year with its source. Status:
 * - "confirmed": legislated / published for that year and cross-checked.
 * - "provisional": not yet published for that year; values carried forward or taken from
 *   legislation that may still be indexed. The UI shows a warning when one is used.
 *
 * IMPORTANT: these rules are an educational estimate, not tax advice. Verify against the
 * ATO before relying on them. Update this file each financial year (see docs/RULESETS.md).
 */

export interface Bracket {
  /** Income (whole dollars) above which `rate` applies. */
  above: number;
  rate: number;
}

export interface HelpTier {
  /** Repayment income (whole dollars) above which this tier applies. */
  above: number;
  /** Marginal: rate applies to income above `above`. Total: rate applies to the whole income. */
  mode: 'marginal' | 'total';
  rate: number;
  /** Fixed amount payable at the start of the tier (marginal mode). */
  base: number;
}

export interface RuleSource {
  label: string;
  url: string;
  note?: string;
}

export interface TaxRuleset {
  id: string;
  financialYear: string; // e.g. "2026-27"
  startDate: string;
  endDate: string;
  status: 'confirmed' | 'provisional';
  statusNote?: string;
  residentBrackets: Bracket[];
  nonResidentBrackets: Bracket[];
  lito: { max: number; fullTo: number; firstTaperTo: number; firstTaperRate: number; secondTaperRate: number };
  medicare: { rate: number; lowerThreshold: number; upperThreshold: number; shadeInRate: number };
  medicareSurcharge: {
    singleTiers: { above: number; rate: number }[];
    familyTiers: { above: number; rate: number }[];
  };
  help: HelpTier[];
  super: {
    guaranteeRate: number;
    concessionalCap: number;
    /** Annualised maximum super contribution base (salary above this attracts no SG). */
    maxContributionBaseAnnual: number;
    contributionsTaxRate: number;
  };
  sources: RuleSource[];
  verifiedOn: string;
}

const ATO_RATES = 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents';
const ATO_FOREIGN = 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-foreign-residents';
const ATO_MEDICARE =
  'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners';
const ATO_MLS =
  'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates';
const ATO_HELP = 'https://www.ato.gov.au/tax-rates-and-codes/study-and-training-support-loans-rates-and-repayment-thresholds';
const ATO_SUPER = 'https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds';
const ATO_LITO =
  'https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-and-middle-income-earner-tax-offsets';

const NON_RESIDENT_FROM_2024: Bracket[] = [
  { above: 0, rate: 0.3 },
  { above: 135000, rate: 0.37 },
  { above: 190000, rate: 0.45 },
];

const LITO = { max: 700, fullTo: 37500, firstTaperTo: 45000, firstTaperRate: 0.05, secondTaperRate: 0.015 };

const MLS_2025_26 = {
  singleTiers: [
    { above: 101000, rate: 0.01 },
    { above: 118000, rate: 0.0125 },
    { above: 158000, rate: 0.015 },
  ],
  familyTiers: [
    { above: 202000, rate: 0.01 },
    { above: 236000, rate: 0.0125 },
    { above: 316000, rate: 0.015 },
  ],
};

export const TAX_RULESETS: TaxRuleset[] = [
  {
    id: 'AU-2025-26',
    financialYear: '2025-26',
    startDate: '2025-07-01',
    endDate: '2026-06-30',
    status: 'confirmed',
    residentBrackets: [
      { above: 0, rate: 0 },
      { above: 18200, rate: 0.16 },
      { above: 45000, rate: 0.3 },
      { above: 135000, rate: 0.37 },
      { above: 190000, rate: 0.45 },
    ],
    nonResidentBrackets: NON_RESIDENT_FROM_2024,
    lito: LITO,
    medicare: { rate: 0.02, lowerThreshold: 28011, upperThreshold: 35013, shadeInRate: 0.1 },
    medicareSurcharge: MLS_2025_26,
    help: [
      { above: 67000, mode: 'marginal', rate: 0.15, base: 0 },
      { above: 125000, mode: 'marginal', rate: 0.17, base: 8700 },
      { above: 179285, mode: 'total', rate: 0.1, base: 0 },
    ],
    super: { guaranteeRate: 0.12, concessionalCap: 30000, maxContributionBaseAnnual: 250000, contributionsTaxRate: 0.15 },
    sources: [
      { label: 'ATO – Tax rates for Australian residents', url: ATO_RATES },
      { label: 'ATO – Tax rates for foreign residents', url: ATO_FOREIGN },
      { label: 'ATO – Medicare levy reduction for low-income earners', url: ATO_MEDICARE },
      { label: 'ATO – Medicare levy surcharge thresholds', url: ATO_MLS, note: 'MLS tiers should be re-checked.' },
      { label: 'ATO – Study and training loan repayment thresholds', url: ATO_HELP, note: 'Marginal HELP repayment system from 2025-26.' },
      { label: 'ATO – Key superannuation rates and thresholds', url: ATO_SUPER },
      { label: 'ATO – Low income tax offset', url: ATO_LITO },
    ],
    verifiedOn: '2026-10-13',
  },
  {
    id: 'AU-2026-27',
    financialYear: '2026-27',
    startDate: '2026-07-01',
    endDate: '2027-06-30',
    status: 'provisional',
    statusNote:
      'Tax brackets (15% rate), HELP thresholds and super caps are from legislation as reported by secondary sources on 13 Oct 2026. Medicare levy low-income and surcharge thresholds are carried forward from 2025-26 until the ATO publishes 2026-27 figures.',
    residentBrackets: [
      { above: 0, rate: 0 },
      { above: 18200, rate: 0.15 },
      { above: 45000, rate: 0.3 },
      { above: 135000, rate: 0.37 },
      { above: 190000, rate: 0.45 },
    ],
    nonResidentBrackets: NON_RESIDENT_FROM_2024,
    lito: LITO,
    medicare: { rate: 0.02, lowerThreshold: 28011, upperThreshold: 35013, shadeInRate: 0.1 },
    medicareSurcharge: MLS_2025_26,
    help: [
      { above: 69528, mode: 'marginal', rate: 0.15, base: 0 },
      { above: 129717, mode: 'marginal', rate: 0.17, base: 9028.35 },
      { above: 186050, mode: 'total', rate: 0.1, base: 0 },
    ],
    super: { guaranteeRate: 0.12, concessionalCap: 32500, maxContributionBaseAnnual: 270830, contributionsTaxRate: 0.15 },
    sources: [
      { label: 'ATO – Tax rates for Australian residents', url: ATO_RATES, note: '16% rate cut to 15% from 1 July 2026.' },
      { label: 'ATO – Tax rates for foreign residents', url: ATO_FOREIGN },
      { label: 'ATO – Medicare levy reduction for low-income earners', url: ATO_MEDICARE, note: 'Carried forward from 2025-26.' },
      { label: 'ATO – Medicare levy surcharge thresholds', url: ATO_MLS, note: 'Carried forward from 2025-26.' },
      { label: 'ATO – Study and training loan repayment thresholds', url: ATO_HELP, note: 'Threshold indexed to $69,528.' },
      { label: 'ATO – Key superannuation rates and thresholds', url: ATO_SUPER, note: 'Concessional cap $32,500; payday super from 1 July 2026.' },
      { label: 'ATO – Low income tax offset', url: ATO_LITO },
    ],
    verifiedOn: '2026-10-13',
  },
  {
    id: 'AU-2027-28',
    financialYear: '2027-28',
    startDate: '2027-07-01',
    endDate: '2028-06-30',
    status: 'provisional',
    statusNote:
      'The legislated cut of the 15% rate to 14% is applied. All other thresholds are carried forward from 2026-27 and will be indexed when published.',
    residentBrackets: [
      { above: 0, rate: 0 },
      { above: 18200, rate: 0.14 },
      { above: 45000, rate: 0.3 },
      { above: 135000, rate: 0.37 },
      { above: 190000, rate: 0.45 },
    ],
    nonResidentBrackets: NON_RESIDENT_FROM_2024,
    lito: LITO,
    medicare: { rate: 0.02, lowerThreshold: 28011, upperThreshold: 35013, shadeInRate: 0.1 },
    medicareSurcharge: MLS_2025_26,
    help: [
      { above: 69528, mode: 'marginal', rate: 0.15, base: 0 },
      { above: 129717, mode: 'marginal', rate: 0.17, base: 9028.35 },
      { above: 186050, mode: 'total', rate: 0.1, base: 0 },
    ],
    super: { guaranteeRate: 0.12, concessionalCap: 32500, maxContributionBaseAnnual: 270830, contributionsTaxRate: 0.15 },
    sources: [{ label: 'ATO – Tax rates for Australian residents', url: ATO_RATES, note: '14% rate from 1 July 2027 (legislated 2025).' }],
    verifiedOn: '2026-10-13',
  },
];

export function rulesetForFinancialYear(fy: string): { ruleset: TaxRuleset; exact: boolean } {
  const exact = TAX_RULESETS.find((r) => r.financialYear === fy);
  if (exact) return { ruleset: exact, exact: true };
  const sorted = [...TAX_RULESETS].sort((a, b) => a.financialYear.localeCompare(b.financialYear));
  // Before the earliest ruleset use the earliest; after the latest, carry the latest forward.
  const fallback = fy < sorted[0].financialYear ? sorted[0] : sorted[sorted.length - 1];
  return { ruleset: fallback, exact: false };
}

export function rulesetById(id: string): TaxRuleset | undefined {
  return TAX_RULESETS.find((r) => r.id === id);
}
