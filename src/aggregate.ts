import type { AggregationUnit, AggregatorOptions, AggregatedChunk, BoundaryResult } from './types';
import { detectWordBoundary } from './units/word';
import { detectLineBoundary } from './units/line';
import { detectParagraphBoundary } from './units/paragraph';
import { detectSentenceBoundary } from './units/sentence';
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

function selectDetector(unit: AggregationUnit, options: AggregatorOptions): (buf: string) => BoundaryResult | null {
  switch (unit) {
    case 'word': return (buf) => detectWordBoundary(buf, options);
    case 'line': return (buf) => detectLineBoundary(buf, options);
    case 'paragraph': return (buf) => detectParagraphBoundary(buf, options);
    case 'sentence': return (buf) => detectSentenceBoundary(buf, options);
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
      const content = options.trimWhitespace === false ? rawContent : rawContent.trim();
      if (content.length > 0) {
        yield { content, unit, index: index++, partial: false, metadata: boundary.metadata };
      }
      buffer = buffer.slice(boundary.nextStart);
      boundary = detect(buffer);
    }
  }

  // Flush remaining buffer
  if (buffer.length > 0) {
    const remaining = options.trimWhitespace === false ? buffer : buffer.trim();
    if (remaining.length === 0) return;

    if (flushMode === 'discard') {
      // nothing
    } else if (flushMode === 'callback') {
      options.onFlush?.(remaining, unit);
    } else {
      // 'emit'
      yield { content: remaining, unit, index: index++, partial: isPartial(remaining, unit) };
    }
  }
}
