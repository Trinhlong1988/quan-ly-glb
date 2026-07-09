// Audit rules (IMS_SPEC §16, R_AUDIT_001..004). Pure helpers for before/after diffing.

export type Json = Record<string, unknown>;

/** Fields never worth auditing (or unsafe to store). */
const REDACT_KEYS = new Set(['password', 'passwordHash', 'password_hash']);

/** Strip sensitive/noisy keys before an object is written to before/after JSON. */
export function auditSnapshot<T extends Json>(obj: T | null | undefined): Json | null {
  if (!obj) return null;
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k)) {
      out[k] = '***';
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * R_AUDIT_002: for an update, compute the set of changed fields as { before, after } pairs.
 * Only keys whose value actually changed are included.
 */
export function diffChanges(before: Json | null, after: Json | null): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const b = auditSnapshot(before) ?? {};
  const a = auditSnapshot(after) ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const k of keys) {
    const bv = b[k];
    const av = a[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      changes[k] = { before: bv, after: av };
    }
  }
  return changes;
}
