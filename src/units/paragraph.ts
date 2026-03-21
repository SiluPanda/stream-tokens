import type { AggregatorOptions, BoundaryResult } from '../types';

/**
 * Detect paragraph boundary: split on \n\n (or \r\n\r\n).
 * Options:
 * - trimWhitespace (default true): trim trailing whitespace from paragraph content
 */
export function detectParagraphBoundary(buffer: string, opts: AggregatorOptions): BoundaryResult | null {
  // Normalize \r\n to \n for detection
  // Look for \n\n pattern
  const idx = buffer.indexOf('\n\n');
  if (idx === -1) {
    // Also check \r\n\r\n
    const crIdx = buffer.indexOf('\r\n\r\n');
    if (crIdx === -1) return null;
    // Found \r\n\r\n
    let nextStart = crIdx + 4;
    while (nextStart < buffer.length && (buffer[nextStart] === '\n' || buffer[nextStart] === '\r')) nextStart++;
    const contentEnd = opts.trimWhitespace !== false ? trimEnd(buffer, crIdx) : crIdx;
    return { boundaryEnd: contentEnd, nextStart };
  }

  // Skip extra consecutive newlines (3+ treated as single boundary)
  let nextStart = idx + 2;
  while (nextStart < buffer.length && (buffer[nextStart] === '\n' || buffer[nextStart] === '\r')) nextStart++;

  // Handle \r before \n\n (content may end with \r)
  let contentEnd = idx;
  if (opts.trimWhitespace !== false) {
    contentEnd = trimEnd(buffer, idx);
  }

  return { boundaryEnd: contentEnd, nextStart };
}

function trimEnd(buffer: string, end: number): number {
  let i = end;
  while (i > 0 && (buffer[i - 1] === ' ' || buffer[i - 1] === '\t' || buffer[i - 1] === '\r')) i--;
  return i;
}
