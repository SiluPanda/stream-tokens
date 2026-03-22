import type { AggregatorOptions, BoundaryResult } from '../types';
import { getAbbreviations } from '../abbreviations';

/**
 * Detect sentence boundary in a buffer.
 *
 * A sentence ends at `.`, `!`, or `?` followed by whitespace and (for periods)
 * an uppercase letter or other sentence-starting character. Handles:
 * - Abbreviations (case-insensitive, configurable)
 * - Decimal numbers (e.g. 3.14)
 * - Ellipsis ("..." — configurable via `ellipsisIsSentenceEnd`)
 * - URL / email context (periods within URLs are not sentence boundaries)
 * - Single-letter initials (e.g. "J. K.")
 * - Closing quotes/parens after punctuation
 * - Multiple punctuation sequences (?!, !!)
 * - `minLength` option — suppress boundaries before minimum character count
 *
 * @param buffer - The current accumulation buffer.
 * @param opts   - Aggregator options.
 * @returns A BoundaryResult if a sentence boundary was found, or null.
 */
export function detectSentenceBoundary(buffer: string, opts: AggregatorOptions): BoundaryResult | null {
  const abbrevs = getAbbreviations({
    additionalAbbreviations: opts.abbreviations?.map(a => a.toLowerCase().replace(/\.$/, '')),
  });
  const ellipsisIsSentenceEnd = opts.ellipsisIsSentenceEnd ?? true;
  const minLength = opts.minLength ?? 0;

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // --- Ellipsis handling ---
    if (ch === '.') {
      // Check for ellipsis: three or more consecutive dots
      if (i + 2 < buffer.length && buffer[i + 1] === '.' && buffer[i + 2] === '.') {
        // Consume the full ellipsis
        let dotEnd = i;
        while (dotEnd < buffer.length && buffer[dotEnd] === '.') dotEnd++;

        if (!ellipsisIsSentenceEnd) {
          // Skip the entire ellipsis, not a sentence end
          i = dotEnd - 1; // loop will increment
          continue;
        }

        // Treat ellipsis as a sentence boundary
        // Skip closing quotes/parens after dots
        let j = dotEnd;
        while (j < buffer.length && (buffer[j] === '"' || buffer[j] === "'" || buffer[j] === ')' || buffer[j] === ']' || buffer[j] === '\u201D')) j++;

        if (j >= buffer.length) {
          // End of buffer — wait for more input for lookahead
          return null;
        }

        const afterChar = buffer[j];
        if (afterChar !== ' ' && afterChar !== '\n' && afterChar !== '\t' && afterChar !== '\r') {
          i = dotEnd - 1;
          continue;
        }

        // Skip whitespace to find next sentence start
        let nextStart = j;
        while (nextStart < buffer.length && (buffer[nextStart] === ' ' || buffer[nextStart] === '\t' || buffer[nextStart] === '\n' || buffer[nextStart] === '\r')) nextStart++;

        if (nextStart >= buffer.length) {
          return null; // Wait for more input
        }

        // Enforce minLength
        const candidateContent = buffer.slice(0, j).trim();
        if (candidateContent.length < minLength) continue;

        return { boundaryEnd: j, nextStart };
      }

      // Single period that is part of an ellipsis already consumed — skip
      if (i > 0 && buffer[i - 1] === '.') continue;
    }

    // --- Multiple punctuation sequences (?!, !!, ??) ---
    // Consume all consecutive sentence-ending punctuation
    let punctEnd = i + 1;
    while (punctEnd < buffer.length && (buffer[punctEnd] === '!' || buffer[punctEnd] === '?' || buffer[punctEnd] === '.')) {
      punctEnd++;
    }
    // Use the last punctuation character position for boundary analysis
    // but only if the additional chars are ! or ? (not period which needs special handling)
    if (punctEnd > i + 1) {
      // Check if additional chars are all ! or ?
      let allExclOrQues = true;
      for (let k = i + 1; k < punctEnd; k++) {
        if (buffer[k] === '.') { allExclOrQues = false; break; }
      }
      if (allExclOrQues) {
        // Treat the whole sequence as one punctuation boundary
        // Skip closing quotes/parens
        let j = punctEnd;
        while (j < buffer.length && (buffer[j] === '"' || buffer[j] === "'" || buffer[j] === ')' || buffer[j] === ']' || buffer[j] === '\u201D')) j++;

        if (j >= buffer.length) {
          // For ! and ? we can emit at end of buffer
          if (ch === '!' || ch === '?') {
            const candidateContent = buffer.slice(0, j).trim();
            if (candidateContent.length < minLength) { i = punctEnd - 1; continue; }
            return { boundaryEnd: j, nextStart: j };
          }
          return null;
        }

        const afterChar = buffer[j];
        if (afterChar === ' ' || afterChar === '\n' || afterChar === '\t' || afterChar === '\r') {
          let nextStart = j;
          while (nextStart < buffer.length && (buffer[nextStart] === ' ' || buffer[nextStart] === '\t' || buffer[nextStart] === '\n' || buffer[nextStart] === '\r')) nextStart++;

          const candidateContent = buffer.slice(0, j).trim();
          if (candidateContent.length < minLength) { i = punctEnd - 1; continue; }

          if (ch === '.' || buffer[punctEnd - 1] === '.') {
            // Has a period — need uppercase confirmation
            if (nextStart >= buffer.length) return null;
            const nextChar = buffer[nextStart];
            if (/[a-z]/.test(nextChar)) { i = punctEnd - 1; continue; }
            if (/\d/.test(nextChar)) { i = punctEnd - 1; continue; }
          }

          return { boundaryEnd: j, nextStart };
        }

        i = punctEnd - 1;
        continue;
      }
    }

    // --- Single punctuation character handling ---
    // Skip closing quotes/parens after punctuation
    let j = i + 1;
    while (j < buffer.length && (buffer[j] === '"' || buffer[j] === "'" || buffer[j] === ')' || buffer[j] === ']' || buffer[j] === '\u201D')) j++;

    // Must have whitespace after (or end of buffer for ! and ?)
    if (j >= buffer.length) {
      if (ch === '!' || ch === '?') {
        const candidateContent = buffer.slice(0, j).trim();
        if (candidateContent.length < minLength) continue;
        return { boundaryEnd: j, nextStart: j };
      }
      // Period: wait for more tokens
      return null;
    }

    const afterChar = buffer[j];
    if (afterChar !== ' ' && afterChar !== '\n' && afterChar !== '\t' && afterChar !== '\r') continue;

    // --- Period-specific disambiguation ---
    if (ch === '.') {
      // Decimal number: digit before period
      if (i > 0 && /\d/.test(buffer[i - 1])) {
        // Look at what follows whitespace — if it's a digit, this is a decimal
        let k = j;
        while (k < buffer.length && (buffer[k] === ' ' || buffer[k] === '\t')) k++;
        if (k < buffer.length && /\d/.test(buffer[k])) continue;
        // Otherwise could be "He scored 72." — fall through
      }

      // Abbreviation: word before period is in abbreviation list
      const wordMatch = buffer.slice(0, i).match(/\b(\w+(?:\.\w+)*)$/);
      if (wordMatch && abbrevs.has(wordMatch[1].toLowerCase())) continue;

      // Single capital letter (e.g. middle initials like J. K.)
      const singleLetter = buffer.slice(0, i).match(/\b([A-Za-z])$/);
      if (singleLetter && singleLetter[1].length === 1) continue;

      // URL / email: period preceded by non-whitespace containing / or @
      const beforePeriod = buffer.slice(0, i);
      const urlMatch = beforePeriod.match(/\S+$/);
      if (urlMatch && (urlMatch[0].includes('/') || urlMatch[0].includes('@') || urlMatch[0].includes('://'))) continue;
    }

    // Skip whitespace to find next sentence start
    let nextStart = j;
    while (nextStart < buffer.length && (buffer[nextStart] === ' ' || buffer[nextStart] === '\t' || buffer[nextStart] === '\n' || buffer[nextStart] === '\r')) nextStart++;

    // For period: need to confirm next visible char is uppercase or end of buffer
    if (ch === '.') {
      if (nextStart >= buffer.length) {
        // Wait for more input to confirm
        return null;
      }
      const nextChar = buffer[nextStart];
      // Deny if next char is lowercase
      if (/[a-z]/.test(nextChar)) continue;
      // Deny if next char is digit (part of decimal)
      if (/\d/.test(nextChar)) continue;
    }

    // Enforce minLength
    const candidateContent = buffer.slice(0, j).trim();
    if (candidateContent.length < minLength) continue;

    return { boundaryEnd: j, nextStart };
  }

  return null;
}
