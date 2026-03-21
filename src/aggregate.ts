import type { AggregationUnit, AggregatorOptions, AggregatedChunk, BoundaryResult } from './types';
import { detectWordBoundary } from './units/word';

const DEFAULT_MAX_BUFFER = 10_000_000;

/**
 * Adapt a ReadableStream<string> to AsyncIterable<string> for Node.js 18+.
 */
async function* readableStreamToAsyncIterable(stream: ReadableStream<string>): AsyncIterable<string> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Detect line boundary: split on newline.
 */
function detectLine(buffer: string, _opts: AggregatorOptions): BoundaryResult | null {
  const idx = buffer.indexOf('\n');
  if (idx === -1) return null;
  return { boundaryEnd: idx, nextStart: idx + 1 };
}

/**
 * Detect paragraph boundary: split on double newline.
 */
function detectParagraph(buffer: string, _opts: AggregatorOptions): BoundaryResult | null {
  const idx = buffer.indexOf('\n\n');
  if (idx === -1) return null;
  // skip extra newlines
  let nextStart = idx + 2;
  while (nextStart < buffer.length && buffer[nextStart] === '\n') nextStart++;
  return { boundaryEnd: idx, nextStart };
}

// Built-in abbreviation list for sentence detection
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc',
  'inc', 'ltd', 'corp', 'dept', 'est', 'fig', 'approx', 'misc',
  'u.s', 'u.k', 'e.g', 'i.e', 'no', 'vol', 'jan', 'feb', 'mar',
  'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'st',
  'ave', 'blvd', 'gen', 'gov', 'lt', 'mt', 'rev', 'sgt', 'spc',
  'supt', 'al', 'div', 'govt', 'assn', 'bros', 'co', 'ed', 'intl',
  'natl', 'univ',
]);

/**
 * Detect sentence boundary using heuristics.
 * A sentence ends at: . ! ? followed by whitespace and an uppercase letter (or end).
 * Handles abbreviations, decimal numbers, ellipsis.
 */
function detectSentence(buffer: string, options: AggregatorOptions): BoundaryResult | null {
  const abbrevs = new Set([
    ...ABBREVIATIONS,
    ...(options.abbreviations ?? []).map(a => a.toLowerCase().replace(/\.$/, '')),
  ]);

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // ellipsis: skip the dots that form ...
    if (ch === '.' && buffer[i + 1] === '.') continue;

    // Check what follows the punctuation (and any closing quotes/parens)
    let j = i + 1;
    // skip closing quotes/parens after punctuation
    while (j < buffer.length && (buffer[j] === '"' || buffer[j] === "'" || buffer[j] === ')' || buffer[j] === ']' || buffer[j] === '\u201d')) j++;

    // Must have whitespace after (or end of buffer)
    if (j >= buffer.length) {
      // End of buffer — only emit if it's ! or ? (unambiguous), or period at very end
      if (ch === '!' || ch === '?') {
        return { boundaryEnd: j, nextStart: j };
      }
      // For period: wait for more tokens to disambiguate
      return null;
    }

    const afterChar = buffer[j];
    if (afterChar !== ' ' && afterChar !== '\n' && afterChar !== '\t' && afterChar !== '\r') continue;

    // For period: check abbreviation and decimal
    if (ch === '.') {
      // decimal: digit before period
      if (i > 0 && /\d/.test(buffer[i - 1])) {
        // Check if next non-whitespace is a digit → decimal number → deny
        let k = j;
        while (k < buffer.length && (buffer[k] === ' ' || buffer[k] === '\t')) k++;
        if (k < buffer.length && /\d/.test(buffer[k])) continue;
        // Otherwise could be "He scored 72." — fall through
      }

      // abbreviation: word before period is in abbreviation list
      const wordMatch = buffer.slice(0, i).match(/\b(\w+(?:\.\w+)*)$/);
      if (wordMatch && abbrevs.has(wordMatch[1].toLowerCase())) continue;

      // single capital letter (e.g. middle initials like J. K.)
      const singleLetter = buffer.slice(0, i).match(/\b([A-Za-z])$/);
      if (singleLetter && singleLetter[1].length === 1) continue;

      // URL/email: period preceded by non-whitespace that contains / or @
      const beforePeriod = buffer.slice(0, i);
      const urlMatch = beforePeriod.match(/\S+$/);
      if (urlMatch && (urlMatch[0].includes('/') || urlMatch[0].includes('@') || urlMatch[0].includes('://'))) continue;
    }

    // Skip whitespace to find next sentence start
    let nextStart = j;
    while (nextStart < buffer.length && (buffer[nextStart] === ' ' || buffer[nextStart] === '\t' || buffer[nextStart] === '\n' || buffer[nextStart] === '\r')) nextStart++;

    // For period: need to confirm the next visible char is uppercase or end of buffer
    if (ch === '.') {
      if (nextStart >= buffer.length) {
        // Wait for more input to confirm
        return null;
      }
      const nextChar = buffer[nextStart];
      // Deny if next char is lowercase
      if (/[a-z]/.test(nextChar)) continue;
      // Deny if next char is digit (part of decimal like "72.5")
      if (/\d/.test(nextChar)) continue;
      // Confirm if uppercase, quote, or other punctuation that starts a sentence
    }

    return { boundaryEnd: j, nextStart };
  }
  return null;
}

/**
 * Detect JSON object/array boundary using depth tracking.
 */
function detectJSON(buffer: string, _opts: AggregatorOptions): BoundaryResult | null {
  // Find first { or [
  let start = -1;
  let startChar = '';
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === '{' || buffer[i] === '[') {
      start = i;
      startChar = buffer[i];
      break;
    }
  }
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < buffer.length; i++) {
    const ch = buffer[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        const type = startChar === '{' ? 'object' : 'array';
        // skip whitespace after
        let nextStart = i + 1;
        while (nextStart < buffer.length && (buffer[nextStart] === ' ' || buffer[nextStart] === '\n' || buffer[nextStart] === '\r' || buffer[nextStart] === '\t')) nextStart++;
        return { boundaryEnd: i + 1, nextStart, contentStart: start, metadata: { type, depth: 0 } };
      }
    }
  }
  return null;
}

/**
 * Detect fenced code block boundary.
 * Looks for opening ``` (or ~~~) fence, accumulates until matching closing fence.
 */
function detectCodeBlock(buffer: string, _opts: AggregatorOptions): BoundaryResult | null {
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

  const end = closeEnd;

  return {
    boundaryEnd: end,
    nextStart: end,
    metadata: { language: language || undefined, fenceLength: fenceLen },
  };
}

/**
 * Detect markdown section boundary.
 * Emits content when a new heading is encountered (the previous section closes).
 */
function detectMarkdownSection(buffer: string, options: AggregatorOptions): BoundaryResult | null {
  const minLevel = options.minLevel ?? 1;
  const maxLevel = options.maxLevel ?? 6;

  // Find a heading pattern at start of line (not the first position — first heading is the START of a section)
  // We need to find the SECOND heading occurrence to close the first section.
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

  // If there's a second heading, emit everything before it
  if (secondMatch !== null) {
    // boundaryEnd is the index where the second heading starts (after the \n)
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
    // There's pre-heading content, emit it
    return {
      boundaryEnd: firstHeadingStart,
      nextStart: firstHeadingStart,
      metadata: { level: 0 },
    };
  }

  return null; // Only one section so far, need more content
}

function selectDetector(unit: AggregationUnit, options: AggregatorOptions): (buf: string) => BoundaryResult | null {
  switch (unit) {
    case 'word': return (buf) => detectWordBoundary(buf, options);
    case 'line': return (buf) => detectLine(buf, options);
    case 'paragraph': return (buf) => detectParagraph(buf, options);
    case 'sentence': return (buf) => detectSentence(buf, options);
    case 'json': return (buf) => detectJSON(buf, options);
    case 'code-block': return (buf) => detectCodeBlock(buf, options);
    case 'markdown-section': return (buf) => detectMarkdownSection(buf, options);
    case 'custom': return options.detect ?? (() => null);
    default: return (buf) => detectLine(buf, options);
  }
}

/** Determine if remaining buffer is partial for the given unit. */
function isPartial(content: string, unit: AggregationUnit): boolean {
  switch (unit) {
    case 'word': return !/\s$/.test(content);
    case 'sentence': return !/[.!?]['"\u201d)]*\s*$/.test(content);
    case 'paragraph': return !/\n\n$/.test(content);
    case 'line': return false; // lines always considered complete on flush
    case 'json': return true; // unclosed JSON is always partial
    case 'code-block': return true; // unclosed code block is partial
    default: return false;
  }
}

export async function* aggregate(
  stream: AsyncIterable<string> | ReadableStream<string>,
  unit: AggregationUnit,
  options: AggregatorOptions = {},
): AsyncIterable<AggregatedChunk> {
  const maxBuf = options.maxBufferSize ?? DEFAULT_MAX_BUFFER;
  const flushMode = options.flush ?? 'emit';
  const detect = selectDetector(unit, options);

  // Normalize input
  const source: AsyncIterable<string> =
    typeof (stream as ReadableStream<string>).getReader === 'function'
      ? readableStreamToAsyncIterable(stream as ReadableStream<string>)
      : (stream as AsyncIterable<string>);

  let buffer = '';
  let index = 0;

  for await (const token of source) {
    buffer += token;

    // Check maxBufferSize overflow
    if (buffer.length >= maxBuf) {
      yield { content: buffer, unit, index: index++, partial: true };
      buffer = '';
      continue;
    }

    // Drain all boundaries from buffer
    let boundary = detect(buffer);
    while (boundary !== null) {
      const rawContent = buffer.slice(boundary.contentStart ?? 0, boundary.boundaryEnd);
      const content = rawContent.trim();
      if (content.length > 0) {
        yield { content, unit, index: index++, partial: false, metadata: boundary.metadata };
      }
      buffer = buffer.slice(boundary.nextStart);
      boundary = detect(buffer);
    }
  }

  // Flush remaining buffer
  if (buffer.length > 0) {
    const trimmed = buffer.trim();
    if (trimmed.length === 0) return;

    if (flushMode === 'discard') {
      // nothing
    } else if (flushMode === 'callback') {
      options.onFlush?.(trimmed, unit);
    } else {
      // 'emit'
      yield { content: trimmed, unit, index: index++, partial: isPartial(trimmed, unit) };
    }
  }
}
