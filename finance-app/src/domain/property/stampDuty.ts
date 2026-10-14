/**
 * State-based land transfer (stamp) duty estimates.
 *
 * Each state has its own versioned ruleset. States without a configured ruleset return
 * `supported: false` — they never fall back to another state's rates.
 *
 * Not modelled: foreign purchaser surcharges, off-the-plan concessions, pensioner and
 * other special concessions, vacant land variants, duty on LMI premiums, grants
 * (e.g. First Home Owner Grant) — these are listed as items needing confirmation.
 */
import type { AustralianState } from '../types';

export interface DutyInput {
  state: AustralianState;
  priceCents: number;
  ownerOccupier: boolean;
  firstHomeBuyer: boolean;
  newHome?: boolean;
}

export interface DutyResult {
  state: AustralianState;
  supported: boolean;
  dutyCents: number;
  generalDutyCents: number;
  concessionLabel: string | null;
  notes: string[];
  rulesetId: string | null;
  effectiveFrom: string | null;
  status: 'confirmed' | 'provisional' | 'unsupported';
  sources: { label: string; url: string }[];
}

export interface DutyBand {
  above: number;
  base: number;
  rate: number;
}

/** Marginal band duty in dollars on `value`, optionally computing on each $100 or part. */
export function bandDuty(value: number, bands: DutyBand[], per100 = false): number {
  const v = per100 ? Math.ceil(value / 100) * 100 : value;
  let band = bands[0];
  for (const b of bands) if (v > b.above) band = b;
  return band.base + (v - band.above) * band.rate;
}

// ---------------------------------------------------------------- Victoria
const VIC_SOURCES = [
  { label: 'SRO Victoria – Land transfer duty current rates', url: 'https://www.sro.vic.gov.au/rates-taxes-duties-and-levies/general-land-transfer-duty-property-current-rates' },
  { label: 'SRO Victoria – Principal place of residence rates', url: 'https://www.sro.vic.gov.au/rates-taxes-duties-and-levies/principal-place-residence-current-rates' },
  { label: 'SRO Victoria – First home buyer duty exemption/concession', url: 'https://www.sro.vic.gov.au/first-home-buyer' },
];

export function vicGeneralDuty(v: number): number {
  if (v <= 25000) return v * 0.014;
  if (v <= 130000) return 350 + (v - 25000) * 0.024;
  if (v <= 960000) return 2870 + (v - 130000) * 0.06;
  if (v <= 2000000) return v * 0.055;
  return 110000 + (v - 2000000) * 0.065;
}

export function vicPprDuty(v: number): number {
  if (v > 130000 && v <= 440000) return 2870 + (v - 130000) * 0.05;
  if (v > 440000 && v <= 550000) return 18370 + (v - 440000) * 0.06;
  return vicGeneralDuty(v);
}

function vic(input: DutyInput): DutyResult {
  const v = input.priceCents / 100;
  const general = vicGeneralDuty(v);
  let duty = general;
  let label: string | null = null;
  const notes: string[] = [];
  if (input.ownerOccupier && v > 130000 && v <= 550000) {
    duty = vicPprDuty(v);
    label = 'Principal place of residence concession';
  }
  if (input.firstHomeBuyer && input.ownerOccupier) {
    if (v <= 600000) {
      duty = 0;
      label = 'First home buyer exemption (≤ $600,000)';
    } else if (v <= 750000) {
      duty = duty * ((v - 600000) / 150000);
      label = 'First home buyer concession ($600,001–$750,000, sliding scale)';
    }
    notes.push('First home buyer relief requires living in the home for 12 continuous months starting within 12 months of settlement.');
  }
  if (input.ownerOccupier && !input.firstHomeBuyer && v > 550000) notes.push('PPR concession does not apply above $550,000.');
  notes.push('Off-the-plan concessions and foreign purchaser additional duty (8%) are not modelled.');
  return {
    state: 'VIC',
    supported: true,
    dutyCents: Math.round(duty) * 100,
    generalDutyCents: Math.round(general) * 100,
    concessionLabel: label,
    notes,
    rulesetId: 'VIC-2025-07',
    effectiveFrom: '2025-07-01',
    status: 'confirmed',
    sources: VIC_SOURCES,
  };
}

// ---------------------------------------------------------------- New South Wales (2026-27, indexed each 1 July)
const NSW_BANDS: DutyBand[] = [
  { above: 0, base: 0, rate: 0.0125 },
  { above: 18000, base: 225, rate: 0.015 },
  { above: 38000, base: 525, rate: 0.0175 },
  { above: 103000, base: 1662, rate: 0.035 },
  { above: 387000, base: 11602, rate: 0.045 },
  { above: 1290000, base: 52237, rate: 0.055 },
  { above: 3870000, base: 194137, rate: 0.07 },
];

export function nswGeneralDuty(v: number): number {
  return Math.max(20, bandDuty(v, NSW_BANDS, true));
}

function nsw(input: DutyInput): DutyResult {
  const v = input.priceCents / 100;
  const general = nswGeneralDuty(v);
  let duty = general;
  let label: string | null = null;
  const notes: string[] = [];
  if (input.firstHomeBuyer && input.ownerOccupier) {
    if (v <= 800000) {
      duty = 0;
      label = 'First Home Buyers Assistance Scheme exemption (≤ $800,000)';
    } else if (v < 1000000) {
      const full = nswGeneralDuty(1000000);
      duty = (full * (v - 800000)) / 200000;
      label = 'First Home Buyers Assistance Scheme concession ($800k–$1m)';
      notes.push('Concession taper approximated linearly — confirm with Revenue NSW.');
    }
  }
  notes.push('The premium property threshold applies to residential land only. Foreign purchaser surcharge duty is not modelled.');
  return {
    state: 'NSW',
    supported: true,
    dutyCents: Math.round(duty) * 100,
    generalDutyCents: Math.round(general) * 100,
    concessionLabel: label,
    notes,
    rulesetId: 'NSW-2026-07',
    effectiveFrom: '2026-07-01',
    status: 'provisional',
    sources: [{ label: 'Revenue NSW – Transfer duty rates', url: 'https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/transfer-duty' }],
  };
}

// ---------------------------------------------------------------- Queensland
const QLD_GENERAL: DutyBand[] = [
  { above: 0, base: 0, rate: 0 },
  { above: 5000, base: 0, rate: 0.015 },
  { above: 75000, base: 1050, rate: 0.035 },
  { above: 540000, base: 17325, rate: 0.045 },
  { above: 1000000, base: 38025, rate: 0.0575 },
];
const QLD_HOME: DutyBand[] = [
  { above: 0, base: 0, rate: 0.01 },
  { above: 350000, base: 3500, rate: 0.035 },
  { above: 540000, base: 10150, rate: 0.045 },
  { above: 1000000, base: 30850, rate: 0.0575 },
];

function qld(input: DutyInput): DutyResult {
  const v = input.priceCents / 100;
  const general = bandDuty(v, QLD_GENERAL, true);
  let duty = general;
  let label: string | null = null;
  const notes: string[] = [];
  if (input.ownerOccupier) {
    duty = bandDuty(v, QLD_HOME, true);
    label = 'Home concession rate';
    if (input.firstHomeBuyer) {
      if (input.newHome) {
        duty = 0;
        label = 'First home (new home) — no transfer duty';
      } else if (v < 700000) {
        duty = 0;
        label = 'First home concession (established home < $700,000)';
      } else if (v < 800000) {
        const step = Math.floor((v - 700000) / 10000);
        const concession = 17350 * (1 - step / 10);
        duty = Math.max(0, duty - concession);
        label = 'First home concession (sliding, $700k–$800k)';
        notes.push('Sliding concession approximated in $10,000 steps — confirm with the QRO calculator.');
      }
    }
    notes.push('From 1 August 2026, home concessions generally require Australian citizenship or permanent residency.');
  }
  return {
    state: 'QLD',
    supported: true,
    dutyCents: Math.round(duty) * 100,
    generalDutyCents: Math.round(general) * 100,
    concessionLabel: label,
    notes,
    rulesetId: 'QLD-2025-05',
    effectiveFrom: '2025-05-01',
    status: 'provisional',
    sources: [{ label: 'Queensland Revenue Office – Transfer duty rates', url: 'https://qro.qld.gov.au/duties/transfer-duty/calculate/rates/' }],
  };
}

// ---------------------------------------------------------------- Other states and territories
// General rates only. Their concessions change often and are listed as notes for the person
// to confirm, rather than guessed. Each is marked provisional until checked on the official page.

const SA_BANDS: DutyBand[] = [
  { above: 0, base: 0, rate: 0.01 },
  { above: 12000, base: 120, rate: 0.02 },
  { above: 30000, base: 480, rate: 0.03 },
  { above: 50000, base: 1080, rate: 0.035 },
  { above: 100000, base: 2830, rate: 0.04 },
  { above: 200000, base: 6830, rate: 0.0425 },
  { above: 250000, base: 8955, rate: 0.0475 },
  { above: 300000, base: 11330, rate: 0.05 },
  { above: 500000, base: 21330, rate: 0.055 },
];

const WA_BANDS: DutyBand[] = [
  { above: 0, base: 0, rate: 0.019 },
  { above: 120000, base: 2280, rate: 0.0285 },
  { above: 150000, base: 3135, rate: 0.038 },
  { above: 360000, base: 11115, rate: 0.0475 },
  { above: 725000, base: 28453, rate: 0.0515 },
];

const TAS_BANDS: DutyBand[] = [
  { above: 0, base: 50, rate: 0 },
  { above: 3000, base: 50, rate: 0.0175 },
  { above: 25000, base: 435, rate: 0.0225 },
  { above: 75000, base: 1560, rate: 0.035 },
  { above: 200000, base: 5935, rate: 0.04 },
  { above: 375000, base: 12935, rate: 0.0425 },
  { above: 725000, base: 27810, rate: 0.045 },
];

// ACT publishes bands to $1,000,000 here; above that the scale changes form, so it isn't estimated.
const ACT_OWNER: DutyBand[] = [
  { above: 0, base: 0, rate: 0.0028 },
  { above: 260000, base: 728, rate: 0.022 },
  { above: 300000, base: 1608, rate: 0.034 },
  { above: 500000, base: 8408, rate: 0.0432 },
  { above: 750000, base: 19208, rate: 0.059 },
];
const ACT_OTHER: DutyBand[] = [
  { above: 0, base: 0, rate: 0.012 },
  { above: 200000, base: 2400, rate: 0.022 },
  { above: 300000, base: 4600, rate: 0.034 },
  { above: 500000, base: 11400, rate: 0.0432 },
  { above: 750000, base: 22200, rate: 0.059 },
];
const ACT_MAX = 1000000;

/** Northern Territory: a formula up to $525,000, then a flat rate on the whole value. */
export function ntDuty(v: number): number {
  if (v <= 525000) {
    const x = v / 1000;
    return 0.06571441 * x * x + 15 * x;
  }
  if (v < 3000000) return v * 0.0495;
  if (v < 5000000) return v * 0.0575;
  return v * 0.0595;
}

const unsupported = (state: AustralianState, note: string): DutyResult => ({
  state,
  supported: false,
  dutyCents: 0,
  generalDutyCents: 0,
  concessionLabel: null,
  notes: [note],
  rulesetId: null,
  effectiveFrom: null,
  status: 'unsupported',
  sources: [],
});

function simple(state: AustralianState, general: number, duty: number, label: string | null, notes: string[], rulesetId: string, effectiveFrom: string, source: { label: string; url: string }): DutyResult {
  return {
    state,
    supported: true,
    dutyCents: Math.round(duty) * 100,
    generalDutyCents: Math.round(general) * 100,
    concessionLabel: label,
    notes,
    rulesetId,
    effectiveFrom,
    status: 'provisional',
    sources: [source],
  };
}

function sa(input: DutyInput): DutyResult {
  const general = bandDuty(input.priceCents / 100, SA_BANDS, true);
  const notes: string[] = ['South Australia has no general owner-occupier or first home concession on established homes.'];
  let duty = general;
  let label: string | null = null;
  if (input.firstHomeBuyer && input.ownerOccupier && input.newHome) {
    duty = 0;
    label = 'First home buyer exemption (new home or land to build on)';
  } else if (input.firstHomeBuyer) notes.push('First home buyers of new homes or vacant land to build on may pay no duty; this listing is not marked as a new home.');
  notes.push('Foreign purchaser additional duty (7%) is not modelled.');
  return simple('SA', general, duty, label, notes, 'SA-2025-07', '2025-07-01', { label: 'RevenueSA – Stamp duty on land transfers', url: 'https://www.revenuesa.sa.gov.au/stampduty/stamp-duty-on-land-transfers' });
}

function wa(input: DutyInput): DutyResult {
  const general = bandDuty(input.priceCents / 100, WA_BANDS, true);
  const notes: string[] = [];
  if (input.firstHomeBuyer && input.ownerOccupier) notes.push('First home owner rates (no duty on lower-priced homes, then a concessional rate) are not modelled because the thresholds changed in 2024, 2025 and 2026. Check the RevenueWA calculator.');
  if (input.ownerOccupier && input.priceCents <= 200000_00) notes.push('A concessional rate may apply to a home worth $200,000 or less.');
  notes.push('Foreign transfer duty (7%) is not modelled.');
  return simple('WA', general, general, null, notes, 'WA-2025-07', '2025-07-01', { label: 'RevenueWA – Transfer duty assessment', url: 'https://www.wa.gov.au/organisation/department-of-treasury-and-finance/transfer-duty-assessment' });
}

function tas(input: DutyInput): DutyResult {
  const general = bandDuty(input.priceCents / 100, TAS_BANDS, true);
  const notes: string[] = [];
  if (input.firstHomeBuyer) notes.push('The first home buyer exemption on established homes up to $750,000 ended for settlements after 30 June 2026. Check the SRO for any replacement.');
  notes.push('Foreign investor duty surcharge is not modelled.');
  return simple('TAS', general, general, null, notes, 'TAS-2025-07', '2025-07-01', { label: 'State Revenue Office Tasmania – Property transfer duties', url: 'https://www.sro.tas.gov.au/property-transfer-duties' });
}

function act(input: DutyInput): DutyResult {
  const v = input.priceCents / 100;
  if (v > ACT_MAX) return unsupported('ACT', 'ACT duty above $1,000,000 is not configured. Use the ACT Revenue Office calculator.');
  const general = bandDuty(v, ACT_OTHER, true);
  let duty = general;
  let label: string | null = null;
  const notes: string[] = [];
  if (input.ownerOccupier) {
    duty = bandDuty(v, ACT_OWNER, true);
    label = 'Owner-occupier rates';
  }
  if (input.ownerOccupier && input.firstHomeBuyer) {
    duty = 0;
    label = 'Home Buyer Concession Scheme (no duty)';
    notes.push('From 1 July 2026 the scheme has no price cap or income test. You must not have owned property in the last 5 years, and must live in the home for 12 months starting within a year of settlement.');
  }
  return simple('ACT', general, duty, label, notes, 'ACT-2026-07', '2026-07-01', { label: 'ACT Revenue Office – Conveyance duty', url: 'https://www.revenue.act.gov.au/rates-and-property-charges/conveyance-duty-stamp-duty/conveyance-duty-for-non-commercial-property' });
}

function nt(input: DutyInput): DutyResult {
  const general = ntDuty(input.priceCents / 100);
  const notes: string[] = [];
  if (input.firstHomeBuyer || input.newHome) notes.push('NT concessions (such as the house and land package exemption for new homes) are not modelled. Check the Territory Revenue Office.');
  return simple('NT', general, general, null, notes, 'NT-2017-07', '2017-07-01', { label: 'Territory Revenue Office – Stamp duty', url: 'https://treasury.nt.gov.au/dtf/territory-revenue-office/stamp-duty' });
}

export const SUPPORTED_DUTY_STATES: AustralianState[] = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'];

export function estimateStampDuty(input: DutyInput): DutyResult {
  if (input.priceCents <= 0) {
    return { state: input.state, supported: SUPPORTED_DUTY_STATES.includes(input.state), dutyCents: 0, generalDutyCents: 0, concessionLabel: null, notes: [], rulesetId: null, effectiveFrom: null, status: 'confirmed', sources: [] };
  }
  switch (input.state) {
    case 'VIC':
      return vic(input);
    case 'NSW':
      return nsw(input);
    case 'QLD':
      return qld(input);
    case 'SA':
      return sa(input);
    case 'WA':
      return wa(input);
    case 'TAS':
      return tas(input);
    case 'ACT':
      return act(input);
    case 'NT':
      return nt(input);
    default:
      return unsupported(input.state, `Stamp duty rules for ${input.state} are not configured. Enter an estimate from the state revenue office calculator.`);
  }
}

/** Government transfer + mortgage registration fees — rough, labelled estimates. */
export function estimateRegistrationFees(state: AustralianState, priceCents: number): { cents: number; note: string } {
  const v = priceCents / 100;
  if (state === 'VIC') {
    const transfer = Math.min(3600, 120 + Math.ceil(v / 1000) * 2.4);
    return { cents: Math.round(transfer + 130) * 100, note: 'Approximate Land Use Victoria transfer fee plus mortgage registration — check the current fee schedule.' };
  }
  return { cents: 1000 * 100, note: 'Placeholder estimate of transfer and mortgage registration fees — check your state land registry.' };
}
