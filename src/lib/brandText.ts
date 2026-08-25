const bracketedLegacyName = String.raw`\[S\]onic\s*\[A\]ssignment\s*\[M\]achine`;
const plainLegacyName = ["Sonic", "Assignment", "Machine"].join(String.raw`\s+`);
const acronym = ["S", "A", "M"].join("");

const LEGACY_BRAND_PATTERNS: Array<[RegExp, string]> = [
  [new RegExp(bracketedLegacyName, "gi"), "SonicSIM.ai"],
  [new RegExp(plainLegacyName, "gi"), "SonicSIM.ai"],
  [new RegExp(`${acronym}\\s+App`, "gi"), "SonicSIM.ai"],
  [new RegExp(`${acronym}-Based\\s+Similarity`, "gi"), "SonicSIM.ai Similarity"],
];

export function replaceLegacyBrandText(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  return LEGACY_BRAND_PATTERNS.reduce(
    (next, [pattern, replacement]) => next.replace(pattern, replacement),
    value,
  );
}