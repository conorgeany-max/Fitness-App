/** Fills fields missing from documents saved by an older version of the app. */
import { emptyPrivate, emptyShared, type PrivateDoc, type SharedDoc } from '@/store/cloudDocs';

export function migrateShared(d: Partial<SharedDoc> | null | undefined): SharedDoc {
  const e = emptyShared();
  return { ...e, ...(d ?? {}), settings: { ...e.settings, ...(d?.settings ?? {}) }, people: { ...e.people, ...(d?.people ?? {}) } };
}

export function migratePrivate(d: Partial<PrivateDoc> | null | undefined): PrivateDoc {
  const e = emptyPrivate();
  return { ...e, ...(d ?? {}), prefs: { ...e.prefs, ...(d?.prefs ?? {}) }, insights: { ...e.insights, ...(d?.insights ?? {}) } };
}
