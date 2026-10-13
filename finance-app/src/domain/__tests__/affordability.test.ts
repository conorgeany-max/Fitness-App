import { describe, expect, it } from 'vitest';
import { analyseAffordability, type HouseholdFinancials, type PropertyCosts } from '../property/affordability';
import type { PropertyPurchaseSettings } from '../types';

const settings: PropertyPurchaseSettings = {
  buyers: 'joint',
  ownership: { me: 50, partner: 50 },
  intendedUse: 'owner-occupier',
  firstHomeBuyer: false,
  homeGuarantee: false,
  depositCents: 16000000,
  interestRate: 0.06,
  termYears: 30,
  repaymentType: 'PI',
  conveyancingCents: 200000,
  inspectionsCents: 80000,
  movingCents: 150000,
  furnishingCents: 500000,
  buildingInsuranceAnnualCents: 180000,
  maintenanceRate: 0.01,
  lmiOverrideCents: null,
  capitaliseLmi: true,
  stressBuffer: 0.03,
  emergencyFundMonths: 6,
  overrides: {},
  currentRentWeeklyCents: null,
  stampDutyOverrideCents: null,
};

const hh: HouseholdFinancials = {
  takeHomeMonthlyCents: 1400000,
  takeHomeByPerson: { me: 800000, partner: 600000 },
  livingCostsMonthlyCents: 500000,
  essentialLivingMonthlyCents: 350000,
  liquidSavingsCents: 25000000,
  otherDebtRepaymentsMonthlyCents: 0,
  netWorthCents: 30000000,
  currentRentMonthlyCents: 250000,
};

const property: PropertyCosts = { priceCents: 80000000, state: 'VIC', strataAnnualCents: 0, councilRatesAnnualCents: 220000, waterAnnualCents: 100000, rentWeeklyCents: 0 };
const market = { investmentReturn: 0.065, propertyGrowth: 0.04, inflation: 0.025, rentGrowth: 0.03 };

describe('property affordability', () => {
  it('purchase costs increase the cash required and reduce the buffer', () => {
    const r = analyseAffordability(property, settings, hh, market);
    const duty = r.upfront.find((u) => u.key === 'duty')!.cents;
    expect(duty).toBe(4307000);
    expect(r.upfrontTotalCents).toBe(r.upfront.reduce((a, u) => a + u.cents, 0));
    expect(r.upfrontTotalCents).toBeGreaterThan(settings.depositCents + duty);
    expect(r.savingsAfterSettlementCents).toBe(hh.liquidSavingsCents - r.upfrontTotalCents);
    const pricier = analyseAffordability({ ...property, priceCents: 90000000 }, settings, hh, market);
    expect(pricier.upfrontTotalCents).toBeGreaterThan(r.upfrontTotalCents);
  });

  it('LVR above 80% adds LMI (capitalised into the loan)', () => {
    const r = analyseAffordability(property, settings, hh, market);
    expect(r.lvr).toBeCloseTo(0.8, 6);
    expect(r.lmiCents).toBe(0);
    const small = analyseAffordability(property, { ...settings, depositCents: 8000000 }, hh, market);
    expect(small.lmiCents).toBeGreaterThan(0);
    expect(small.loanCents).toBe(small.baseLoanCents + small.lmiCents);
  });

  it('higher interest rates raise repayments and can change the assessment', () => {
    const r = analyseAffordability(property, settings, hh, market);
    const high = analyseAffordability(property, { ...settings, interestRate: 0.09 }, hh, market);
    expect(high.repaymentMonthlyCents).toBeGreaterThan(r.repaymentMonthlyCents);
    expect(high.disposableMonthlyCents).toBeLessThan(r.disposableMonthlyCents);
    expect(r.stressRepaymentMonthlyCents).toBeGreaterThan(r.repaymentMonthlyCents);
    const order = ['comfortable', 'manageable', 'stretched', 'not-supported'];
    expect(order.indexOf(high.label)).toBeGreaterThanOrEqual(order.indexOf(r.label));
  });

  it('reports not supported when savings cannot cover settlement', () => {
    const r = analyseAffordability(property, settings, { ...hh, liquidSavingsCents: 10000000 }, market);
    expect(r.label).toBe('not-supported');
    expect(r.checks.find((c) => c.id === 'upfront')!.result).toBe('fail');
  });

  it('models single-income scenarios and gives improvement suggestions', () => {
    const r = analyseAffordability(property, settings, hh, market);
    expect(r.singleIncome).toHaveLength(2);
    expect(r.singleIncome.find((s) => s.person === 'me')!.disposableCents).toBe(r.disposableMonthlyCents - 800000);
    if (r.label !== 'comfortable') expect(r.toImprove.length).toBeGreaterThan(0);
  });

  it('net worth after purchase falls by transaction costs only', () => {
    const r = analyseAffordability(property, settings, hh, market);
    const sunk = r.upfront.filter((u) => ['duty', 'registration', 'conveyancing', 'inspections', 'lmi', 'moving', 'furnishing'].includes(u.key)).reduce((a, u) => a + u.cents, 0);
    expect(r.netWorthAfterPurchaseCents).toBe(hh.netWorthCents - sunk);
  });

  it('a modest purchase for a strong household is comfortable', () => {
    const r = analyseAffordability({ ...property, priceCents: 50000000 }, { ...settings, depositCents: 15000000 }, { ...hh, liquidSavingsCents: 40000000 }, market);
    expect(r.label).toBe('comfortable');
  });
});
