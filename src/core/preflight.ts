export interface PreflightResult {
  ok: boolean;
  risk: "low" | "medium" | "high";
  matches: string[];
  originalPrompt: string;
  safePrompt: string;
  rewritten: boolean;
  reasons: string[];
}

const THIRD_PARTY_PATTERNS: Array<{ label: string; re: RegExp; replacement: string }> = [
  { label: "iron-man", re: /\biron\s*man\b/gi, replacement: "an original futuristic rescue exoskeleton character" },
  { label: "marvel", re: /\bmarvel\b/gi, replacement: "an original science-fiction setting" },
  { label: "batman", re: /\bbatman\b/gi, replacement: "an original nocturnal technology-based protector" },
  { label: "superman", re: /\bsuperman\b/gi, replacement: "an original powerful rescue character" },
  { label: "spider-man", re: /\bspider[- ]?man\b/gi, replacement: "an original agile rescue character" },
  { label: "star-wars", re: /\bstar\s*wars\b/gi, replacement: "an original space-opera setting" },
  { label: "transformers", re: /\btransformers?\b/gi, replacement: "original industrial transforming robots" },
  { label: "disney", re: /\bdisney\b/gi, replacement: "an original family-friendly cinematic style" },
  { label: "pixar", re: /\bpixar\b/gi, replacement: "an original stylized cinematic animation" },
  { label: "คล้ายไอรอนแมน", re: /คล้าย\s*ไอรอนแมน/gi, replacement: "เป็นตัวละครเทคโนโลยีออริจินัล" },
  { label: "ไอรอนแมน", re: /ไอรอน\s*แมน/gi, replacement: "วิศวกรกู้ภัยในโครงช่วยแรงออริจินัล" },
  { label: "มาร์เวล", re: /มาร์เวล/gi, replacement: "โลกไซไฟออริจินัล" }
];

export function preflightPrompt(prompt: string, autoRewrite = true): PreflightResult {
  const originalPrompt = String(prompt || "").trim();
  const matches: string[] = [];
  let safePrompt = originalPrompt;
  for (const rule of THIRD_PARTY_PATTERNS) {
    rule.re.lastIndex = 0;
    if (rule.re.test(originalPrompt)) matches.push(rule.label);
    rule.re.lastIndex = 0;
    if (autoRewrite) safePrompt = safePrompt.replace(rule.re, rule.replacement);
  }
  const comparison = /(inspired\s+by|looks?\s+like|same\s+as|เหมือน|เลียนแบบ|แรงบันดาลใจจาก)/i.test(originalPrompt);
  if (comparison) matches.push("comparison-language");
  if (autoRewrite && comparison) safePrompt = safePrompt.replace(/inspired\s+by/gi, "designed as").replace(/looks?\s+like/gi, "designed as an original").replace(/same\s+as/gi, "distinct from existing works and designed as").replace(/แรงบันดาลใจจาก/gi, "ออกแบบเป็น").replace(/คล้าย/gi, "มีเอกลักษณ์ออริจินัล").replace(/เลียนแบบ/gi, "ออกแบบใหม่เป็น");
  const unique = [...new Set(matches)];
  const risk: PreflightResult["risk"] = unique.length >= 2 ? "high" : unique.length === 1 ? "medium" : "low";
  if (autoRewrite && unique.length) {
    safePrompt += "\nUse a fully original character silhouette, costume geometry, symbols, materials and color blocking. Do not reproduce recognizable franchise-specific designs, logos or insignia.";
  }
  return {
    ok: risk !== "high",
    risk,
    matches: unique,
    originalPrompt,
    safePrompt,
    rewritten: autoRewrite && safePrompt !== originalPrompt,
    reasons: unique.length ? ["Potential third-party character/style references detected before paid generation."] : []
  };
}

export function isGuardrailError(message: string): boolean {
  return /(third[- ]party|guardrail|raiMediaFiltered|safety|filtered|copyright|policy)/i.test(message || "");
}
