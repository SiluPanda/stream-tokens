import type { AggregatorOptions, BoundaryResult } from '../types';

/**
 * Detect line boundary: split on \n.
 *
 * Options:
 * - `includeNewline` (default false): if true, include the newline character
 *   in the emitted content (boundaryEnd covers the \n).
 * - `skipEmpty` (default false): if true, skip past empty lines without
 *   emitting them. An empty line is one where there are zero non-whitespace
 *   characters between two newlines (or at the start of the buffer).
 *
 * Edge cases:
 * - `\r\n` is treated as a single newline; the `\r` is stripped from content.
 * - Consecutive `\n\n` emit an empty string between them (unless skipEmpty).
 * - Content at stream end without trailing `\n` is handled by the aggregate
 *   flush logic, not by this detector.
 *
 * @param buffer - The current accumulation buffer.
 * @param opts   - Aggregator options.
 * @returns A BoundaryResult if a line boundary was found, or null.
 */
export function detectLineBoundary(buffer: string, opts: AggregatorOptions): BoundaryResult | null {
  const includeNewline = opts.includeNewline ?? false;
  const skipEmpty = opts.skipEmpty ?? false;

  let offset = 0;

  while (offset < buffer.length) {
    const idx = buffer.indexOf('\n', offset);
    if (idx === -1) return null;

    // Handle \r\n — content ends before the \r
    const contentEnd = (idx > 0 && buffer[idx - 1] === '\r') ? idx - 1 : idx;

    const boundaryEnd = includeNewline ? idx + 1 : contentEnd;
    const nextStart = idx + 1;

    // Check if this is an empty line
    if (skipEmpty) {
      const lineContent = buffer.slice(offset, contentEnd);
      if (lineContent.length === 0) {
        // Skip this empty line by advancing offset and continuing
        offset = nextStart;
        continue;
      }
    }

    // Adjust boundaryEnd relative to full buffer (offset is always 0 on first
    // hit, but may be >0 if we skipped empty lines above).
    if (offset > 0) {
      // We skipped some empty lines. Return a boundary that consumes
      // everything from buffer start through this line.
      return {
        boundaryEnd,
        nextStart,
        contentStart: offset,
      };
    }

    return { boundaryEnd, nextStart };
  }

  // Only reached when skipEmpty skipped all lines in the buffer
  // (every line was empty). Return null — nothing to emit.
  // But we need to consume the empty lines so the buffer doesn't grow.
  if (skipEmpty && offset > 0) {
    // All content so far was empty lines. Return a boundary with empty content
    // so the aggregate loop can advance the buffer.
    return { boundaryEnd: 0, nextStart: offset };
  }

  return null;
}
