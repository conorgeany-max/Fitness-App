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

export const SUPPORTED_DUTY_STATES: AustralianState[] = ['VIC', 'NSW', 'QLD'];

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
    default:
      return {
        state: input.state,
        supported: false,
        dutyCents: 0,
        generalDutyCents: 0,
        concessionLabel: null,
        notes: [`Stamp duty rules for ${input.state} are not configured yet. Enter an estimate from the state revenue office calculator — Victorian rates are never used for other states.`],
        rulesetId: null,
        effectiveFrom: null,
        status: 'unsupported',
        sources: [],
      };
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
