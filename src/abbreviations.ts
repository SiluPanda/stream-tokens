/**
 * Default abbreviation set for sentence boundary detection.
 *
 * All entries are stored lowercase without trailing periods.
 * Matching is case-insensitive.
 */
const DEFAULT_ABBREVIATIONS: ReadonlySet<string> = new Set([
  // Titles
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr',
  // Places / addresses
  'st', 'ave', 'blvd', 'mt',
  // Organizations / roles
  'dept', 'est', 'fig', 'gen', 'gov', 'lt', 'rev', 'sgt', 'spc', 'supt',
  'inc', 'ltd', 'corp', 'assn', 'bros', 'co',
  // Academic / publishing
  'ed', 'intl', 'natl', 'univ', 'vol', 'no',
  // Common abbreviations
  'vs', 'etc', 'al', 'approx', 'div', 'govt', 'misc',
  // Country abbreviations (with internal dots kept for matching)
  'u.s', 'u.k',
  // Latin abbreviations
  'e.g', 'i.e',
  // Months
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]);

export interface AbbreviationOptions {
  /** Replace the entire default set with this list. */
  abbreviations?: string[];
  /** Extend the default set with additional abbreviations. */
  additionalAbbreviations?: string[];
}

/**
 * Build a set of abbreviations for sentence boundary detection.
 *
 * Returns a `Set<string>` of lowercase abbreviations without trailing periods.
 *
 * @param options - Optional overrides / extensions to the default set.
 */
export function getAbbreviations(options?: AbbreviationOptions): Set<string> {
  if (options?.abbreviations) {
    // Replace default list entirely
    return new Set(options.abbreviations.map(a => a.toLowerCase().replace(/\.$/, '')));
  }

  const result = new Set(DEFAULT_ABBREVIATIONS);

  if (options?.additionalAbbreviations) {
    for (const a of options.additionalAbbreviations) {
      result.add(a.toLowerCase().replace(/\.$/, ''));
    }
  }

  return result;
}
