import type { AggregatorOptions, BoundaryResult } from '../types';

/**
 * Check if a character is whitespace (space, tab, newline, carriage return).
 */
function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
}

/**
 * Detect word boundary in a buffer.
 *
 * A word is complete when the buffer contains whitespace after a non-whitespace
 * sequence. Words include hyphenated compounds ("well-known") and contractions
 * ("don't") as single units. Punctuation attached to words ("Hello,") is kept
 * when preservePunctuation is true (default).
 *
 * @param buffer - The current accumulation buffer.
 * @param opts - Aggregator options. Supports `includeWhitespace` (default false)
 *   and `preservePunctuation` (default true).
 * @returns A BoundaryResult if a complete word boundary was found, or null.
 */
export function detectWordBoundary(buffer: string, opts: AggregatorOptions): BoundaryResult | null {
  const includeWhitespace = opts.includeWhitespace ?? false;

  // Find first non-whitespace character
  const trimStart = buffer.search(/\S/);
  if (trimStart === -1) return null; // only whitespace, no word yet

  // Find first whitespace after the non-whitespace run
  let wsIdx = -1;
  for (let i = trimStart; i < buffer.length; i++) {
    const c = buffer[i];
    if (isWhitespace(c)) {
      wsIdx = i;
      break;
    }
  }
  if (wsIdx === -1) return null; // no whitespace yet, word incomplete

  if (includeWhitespace) {
    // Include trailing whitespace in the word content
    let trailingEnd = wsIdx + 1;
    while (trailingEnd < buffer.length && isWhitespace(buffer[trailingEnd])) {
      trailingEnd++;
    }
    // If we consumed all remaining chars and they are all whitespace,
    // the next word hasn't started — but we still emit with whitespace attached.
    return { boundaryEnd: trailingEnd, nextStart: trailingEnd };
  }

  // Default: skip trailing whitespace for nextStart
  let nextStart = wsIdx + 1;
  while (nextStart < buffer.length && isWhitespace(buffer[nextStart])) {
    nextStart++;
  }
  return { boundaryEnd: wsIdx, nextStart };
}
