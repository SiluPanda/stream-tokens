import type { AggregationUnit, AggregatorOptions, AggregatedChunk, BoundaryResult } from './types';
import { detectWordBoundary } from './units/word';
import { detectLineBoundary } from './units/line';
import { detectParagraphBoundary } from './units/paragraph';
import { detectJsonBoundary } from './units/json';
import { detectCodeBlockBoundary } from './units/code-block';
import { detectMarkdownSectionBoundary } from './units/markdown-section';

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


function selectDetector(unit: AggregationUnit, options: AggregatorOptions): (buf: string) => BoundaryResult | null {
  switch (unit) {
    case 'word': return (buf) => detectWordBoundary(buf, options);
    case 'line': return (buf) => detectLineBoundary(buf, options);
    case 'paragraph': return (buf) => detectParagraphBoundary(buf, options);
    case 'sentence': return (buf) => detectSentence(buf, options);
    case 'json': return (buf) => detectJsonBoundary(buf, options);
    case 'code-block': return (buf) => detectCodeBlockBoundary(buf, options);
    case 'markdown-section': return (buf) => detectMarkdownSectionBoundary(buf, options);
    case 'custom': return options.detect ?? (() => null);
    default: return (buf) => detectLineBoundary(buf, options);
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
    case 'markdown-section': return true; // last section without a closing heading is partial
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
