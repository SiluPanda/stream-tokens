import type { AggregatorOptions, BoundaryResult } from '../types';

/**
 * Detect fenced code block boundary.
 *
 * Scans the buffer for an opening fence (``` or ~~~, three or more chars) at
 * the start of a line, then accumulates content until a matching closing fence
 * of the same type and equal-or-greater length appears on its own line.
 *
 * Supports:
 * - Both backtick (```) and tilde (~~~) fence styles
 * - Language specifier tags (```typescript)
 * - Fences with more than three characters (````  ````  )
 * - Nested content — only the matching closing fence ends the block
 *
 * Metadata on the returned BoundaryResult:
 * - `language`: the language tag string (e.g. "typescript"), or undefined
 * - `fenceLength`: number of fence characters in the opening fence
 *
 * @param buffer - The current accumulation buffer.
 * @param _opts  - Aggregator options (currently unused for code-block detection).
 * @returns A BoundaryResult if a complete code block was found, or null.
 */
export function detectCodeBlockBoundary(buffer: string, _opts: AggregatorOptions): BoundaryResult | null {
  // Find opening fence at start of a line (or start of buffer)
  const openMatch = buffer.match(/(?:^|\n)(`{3,}|~{3,})(.*)\n/);
  if (!openMatch) return null;

  const openMatchIndex = buffer.indexOf(openMatch[0]);

  const fence = openMatch[1]; // the backticks/tildes
  const language = openMatch[2].trim();
  const fenceChar = fence[0];
  const fenceLen = fence.length;

  // Content starts after the opening fence line
  const afterOpen = openMatchIndex + openMatch[0].length;

  // Look for matching closing fence (same or more fence chars at start of line)
  const remaining = buffer.slice(afterOpen);
  const closeMatch = remaining.match(new RegExp(`(?:^|\n)${fenceChar === '`' ? '`' : '~'}{${fenceLen},}[ \\t]*(?:\\n|$)`));
  if (!closeMatch) return null;

  const closeRelIdx = remaining.indexOf(closeMatch[0]);
  const closeEnd = afterOpen + closeRelIdx + closeMatch[0].length;

  return {
    boundaryEnd: closeEnd,
    nextStart: closeEnd,
    metadata: { language: language || undefined, fenceLength: fenceLen },
  };
}
