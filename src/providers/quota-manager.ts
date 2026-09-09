type Cooldown = { until: number; reason?: string };
const cooldowns = new Map<string, Cooldown>();

export function setProviderCooldown(provider: string, delayMs: number, reason?: string): void {
  const ms = Math.max(0, Number(delayMs || 0));
  if (!ms) return;
  const until = Date.now() + ms;
  const existing = cooldowns.get(provider);
  if (!existing || existing.until < until) cooldowns.set(provider, { until, reason });
}

export function getProviderCooldown(provider: string): { active: boolean; remainingMs: number; reason?: string } {
  const row = cooldowns.get(provider);
  if (!row) return { active: false, remainingMs: 0 };
  const remainingMs = row.until - Date.now();
  if (remainingMs <= 0) { cooldowns.delete(provider); return { active: false, remainingMs: 0 }; }
  return { active: true, remainingMs, reason: row.reason };
}

export function clearProviderCooldown(provider?: string): void {
  if (provider) cooldowns.delete(provider);
  else cooldowns.clear();
}
