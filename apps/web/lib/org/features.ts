/**
 * Per-organization feature flags, as resolved by the API.
 *
 * `resolved_features` is absent on very old configs; in that case we keep the
 * previous behaviour (enabled) rather than locking an org out of a page it
 * never explicitly disabled.
 */
export function isOrgFeatureEnabled(org: any, feature: string): boolean {
  const resolved = org?.config?.config?.resolved_features
  const entry = resolved?.[feature]
  if (!entry) return true
  return entry.enabled === true
}
