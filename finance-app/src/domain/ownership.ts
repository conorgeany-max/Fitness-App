import { allocate, type Cents } from './money';
import type { Ownership, Perspective, PersonId } from './types';

export const OWN_ME: Ownership = { me: 100, partner: 0 };
export const OWN_PARTNER: Ownership = { me: 0, partner: 100 };
export const OWN_JOINT: Ownership = { me: 50, partner: 50 };

export type OwnershipPreset = 'me' | 'partner' | 'joint' | 'custom';

export function ownershipPreset(o: Ownership): OwnershipPreset {
  if (o.me === 100 && o.partner === 0) return 'me';
  if (o.me === 0 && o.partner === 100) return 'partner';
  if (o.me === 50 && o.partner === 50) return 'joint';
  return 'custom';
}

export function presetOwnership(p: Exclude<OwnershipPreset, 'custom'>): Ownership {
  return p === 'me' ? { ...OWN_ME } : p === 'partner' ? { ...OWN_PARTNER } : { ...OWN_JOINT };
}

/** Returns an error message, or null when the allocation is valid. */
export function validateOwnership(o: Ownership): string | null {
  if (!Number.isFinite(o.me) || !Number.isFinite(o.partner)) return 'Ownership must be a number.';
  if (o.me < 0 || o.partner < 0) return 'Ownership cannot be negative.';
  if (o.me > 100 || o.partner > 100) return 'Ownership cannot exceed 100%.';
  const hundredths = Math.round(o.me * 100) + Math.round(o.partner * 100);
  if (hundredths !== 10000) return `Ownership must add up to 100% (currently ${(hundredths / 100).toFixed(2)}%).`;
  return null;
}

/** Build a valid allocation from one person's percentage. */
export function ownershipFromMe(mePct: number): Ownership {
  const me = Math.min(100, Math.max(0, Math.round(mePct * 100) / 100));
  return { me, partner: Math.round((100 - me) * 100) / 100 };
}

/**
 * Split an amount between the two people. Parts always add back to the total exactly,
 * so individual views reconcile to the household view.
 */
export function splitByOwnership(total: Cents, o: Ownership): Record<PersonId, Cents> {
  const [me, partner] = allocate(total, [Math.round(o.me * 100), Math.round(o.partner * 100)]);
  return { me, partner };
}

/**
 * The amount of `total` that belongs in a perspective.
 * Household = the full amount, counted once. Individual = the person's attributed share.
 */
export function amountForPerspective(total: Cents, o: Ownership, perspective: Perspective): Cents {
  if (perspective === 'household') return total;
  return splitByOwnership(total, o)[perspective];
}

export function shareFraction(o: Ownership, perspective: Perspective): number {
  if (perspective === 'household') return 1;
  return o[perspective] / 100;
}

/** True when the item involves the person at all. */
export function involves(o: Ownership, person: PersonId): boolean {
  return o[person] > 0;
}

/** The single owner, if the item is wholly owned by one person. */
export function soleOwner(o: Ownership): PersonId | null {
  if (o.me === 100) return 'me';
  if (o.partner === 100) return 'partner';
  return null;
}

export function ownershipLabel(o: Ownership, names: Record<PersonId, string>): string {
  const preset = ownershipPreset(o);
  if (preset === 'me') return names.me;
  if (preset === 'partner') return names.partner;
  if (preset === 'joint') return 'Joint 50/50';
  return `Joint ${trim(o.me)}/${trim(o.partner)}`;
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
