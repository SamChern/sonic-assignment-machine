// Sensitive-category suppression (Step 7 compliance wiring).
//
// Intuizi visitation/POI feeds can carry place classes that must never become
// part of a sonic profile: health care, places of worship, shelters, addiction
// and reproductive services, correctional facilities, and similar.
// Nodes matching these patterns are stored with `taxonomy_nodes.suppressed =
// true` and are skipped when tagging an audio source, so no suppressed class
// ever reaches scoring, cohorts, or an Activation file.

export const SENSITIVE_PATTERNS: RegExp[] = [
  // Health & medical
  /\b(health|healthcare|hospital|clinic|medical|medicine|physician|doctor|dentist|urgent[\s_-]?care|oncology|dialysis|therapy|therapist|psychiatr|mental[\s_-]?health|pharmac|drugstore|lab[\s_-]?test|blood[\s_-]?donation|hospice|nursing[\s_-]?home|disabilit|hiv|std|cancer)\b/i,
  // Reproductive & addiction services
  /\b(planned[\s_-]?parenthood|abortion|fertility|prenatal|obgyn|rehab|rehabilitation[\s_-]?cent|addiction|methadone|substance[\s_-]?abuse|alcoholics[\s_-]?anonymous|narcotics[\s_-]?anonymous)\b/i,
  // Religion & worship
  /\b(worship|church|chapel|cathedral|mosque|masjid|synagog|temple|shrine|gurdwara|monaster|religio|faith|parish|ministry)\b/i,
  // Shelters & social services
  /\b(shelter|homeless|food[\s_-]?bank|soup[\s_-]?kitchen|refugee|asylum|domestic[\s_-]?violence|crisis[\s_-]?cent|halfway[\s_-]?house|welfare)\b/i,
  // Legal / correctional / political / union / sexual orientation
  /\b(prison|jail|correctional|probation|immigration[\s_-]?cent|political[\s_-]?part|campaign[\s_-]?office|labor[\s_-]?union|lgbt|gay[\s_-]?bar|adult[\s_-]?entertainment|strip[\s_-]?club)\b/i,
];

/**
 * True when a taxonomy code or label describes a sensitive class that must be
 * suppressed. Matching is intentionally conservative in one direction only:
 * false positives cost a tag, false negatives cost compliance.
 */
export function isSensitiveTag(code: string, label?: string | null): boolean {
  const haystack = `${code ?? ""} ${label ?? ""}`.replace(/[._]/g, " ");
  return SENSITIVE_PATTERNS.some((re) => re.test(haystack));
}

/** SQL-ready patterns for seeding/refreshing `taxonomy_nodes.suppressed`. */
export const SENSITIVE_SQL_PATTERNS = SENSITIVE_PATTERNS.map((re) => re.source);
