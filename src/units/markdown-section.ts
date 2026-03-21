import type { AggregatorOptions, BoundaryResult } from '../types';

/**
 * Detect markdown section boundary.
 *
 * A markdown section starts at a heading line (# through ######) and extends
 * until the next heading of the same or higher level (lower number = higher
 * level in ATX heading notation).
 *
 * Boundary logic:
 * - When two headings are found in the buffer, everything before the second
 *   heading is emitted as one section. The metadata reflects the FIRST heading.
 * - If there is content before the first heading, that pre-heading content is
 *   emitted first as a section with `metadata.level = 0`.
 * - If only one heading has been seen so far, null is returned (wait for more).
 *
 * Options:
 * - `minLevel` (default 1): minimum heading level (# = level 1) to split on.
 * - `maxLevel` (default 6): maximum heading level to split on.
 *
 * Metadata on the returned BoundaryResult:
 * - `level`: heading level of the section's heading (0 for pre-heading content)
 * - `heading`: the heading text (without the leading #s), or undefined for level 0
 *
 * @param buffer  - The current accumulation buffer.
 * @param options - Aggregator options.
 * @returns A BoundaryResult if a complete section boundary was found, or null.
 */
export function detectMarkdownSectionBoundary(buffer: string, options: AggregatorOptions): BoundaryResult | null {
  const minLevel = options.minLevel ?? 1;
  const maxLevel = options.maxLevel ?? 6;

  // Find heading patterns at start of line.
  // We need the SECOND heading to close the first section.
  const headingRegex = new RegExp(`(?:^|\n)(#{${minLevel},${maxLevel}}) (.+)`, 'g');
  let firstMatch: RegExpExecArray | null = null;
  let secondMatch: RegExpExecArray | null = null;

  let m: RegExpExecArray | null;
  while ((m = headingRegex.exec(buffer)) !== null) {
    if (firstMatch === null) {
      firstMatch = m;
    } else {
      secondMatch = m;
      break;
    }
  }

  if (firstMatch === null) return null; // No heading at all

  // If there's a second heading, emit everything before it as one section
  if (secondMatch !== null) {
    // boundaryEnd is the index where the second heading starts (skip the leading \n)
    const boundaryEnd = secondMatch.index + (secondMatch[0].startsWith('\n') ? 1 : 0);
    const hashes = firstMatch[1];
    const headingText = firstMatch[2];
    return {
      boundaryEnd,
      nextStart: boundaryEnd,
      metadata: { level: hashes.length, heading: headingText },
    };
  }

  // Only one heading found: check if there's content BEFORE the first heading
  const firstHeadingStart = firstMatch.index + (firstMatch[0].startsWith('\n') ? 1 : 0);
  if (firstHeadingStart > 0) {
    // Pre-heading content — emit it as a section with level 0
    return {
      boundaryEnd: firstHeadingStart,
      nextStart: firstHeadingStart,
      metadata: { level: 0 },
    };
  }

  return null; // Only one section so far, need more content
}
