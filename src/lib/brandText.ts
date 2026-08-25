const LEGACY_BRAND_PATTERNS: Array<[RegExp, string]> = [
  [/\[S\]onic\s*\[A\]ssignment\s*\[M\]achine/gi, "SonicSIM.ai"],
  [/Sonic\s+Assignment\s+Machine/gi, "SonicSIM.ai"],
  [/SAM\s+App/gi, "SonicSIM.ai"],
  [/SAM-Based\s+Similarity/gi, "SonicSIM.ai Similarity"],
];

export function replaceLegacyBrandText(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  return LEGACY_BRAND_PATTERNS.reduce(
    (next, [pattern, replacement]) => next.replace(pattern, replacement),
    value,
  );
}