import { describe, it, expect } from 'vitest';
import { aggregate, paragraphs, detectParagraphBoundary } from '../index';
import type { AggregatedChunk } from '../types';

/** Collect all chunks from an async iterable. */
async function collect(it: AsyncIterable<AggregatedChunk>): Promise<AggregatedChunk[]> {
  const result: AggregatedChunk[] = [];
  for await (const chunk of it) {
    result.push(chunk);
  }
  return result;
}

/** Create an async iterable from an array of string tokens. */
async function* makeStream(tokens: string[]): AsyncIterable<string> {
  for (const t of tokens) {
    yield t;
  }
}

// ─── 1. detectParagraphBoundary unit tests ──────────────────────────────────

describe('detectParagraphBoundary — direct', () => {
  it('returns null for empty string', () => {
    expect(detectParagraphBoundary('', {})).toBeNull();
  });

  it('returns null when no double newline in buffer', () => {
    expect(detectParagraphBoundary('hello\nworld', {})).toBeNull();
  });

  it('detects boundary on \\n\\n', () => {
    const result = detectParagraphBoundary('hello\n\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5);
    expect(result!.nextStart).toBe(7);
  });

  it('detects boundary on \\r\\n\\r\\n', () => {
    const result = detectParagraphBoundary('hello\r\n\r\nworld', {});
    expect(result).not.toBeNull();
    // trimWhitespace default true trims trailing \r
    expect(result!.boundaryEnd).toBe(5);
    expect(result!.nextStart).toBe(9);
  });

  it('skips extra consecutive newlines (3+)', () => {
    const result = detectParagraphBoundary('hello\n\n\n\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5);
    expect(result!.nextStart).toBe(9);
  });

  it('trimWhitespace true (default) trims trailing spaces', () => {
    const result = detectParagraphBoundary('hello   \n\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5); // trimmed trailing spaces
  });

  it('trimWhitespace true trims trailing tabs', () => {
    const result = detectParagraphBoundary('hello\t\t\n\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5); // trimmed trailing tabs
  });

  it('trimWhitespace true trims trailing \\r', () => {
    const result = detectParagraphBoundary('hello\r\n\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5); // trimmed trailing \r
  });

  it('trimWhitespace false preserves content end index', () => {
    const result = detectParagraphBoundary('hello   \n\nworld', { trimWhitespace: false });
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(8); // includes trailing spaces
  });

  it('handles \\r\\n\\r\\n with trimWhitespace false', () => {
    // 'hello\r\n\r\nworld': h(0)e(1)l(2)l(3)o(4)\r(5)\n(6)\r(7)\n(8)w(9)
    // indexOf('\n\n') fails (pos 6 is \n, pos 7 is \r)
    // Falls through to \r\n\r\n check: crIdx = 5
    // With trimWhitespace false, boundaryEnd = crIdx = 5
    const result = detectParagraphBoundary('hello\r\n\r\nworld', { trimWhitespace: false });
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5);
    expect(result!.nextStart).toBe(9);
  });
});

// ─── 2. Basic paragraph splitting ──────────────────────────────────────────

describe('Paragraph splitting — basic', () => {
  it('splits two paragraphs on \\n\\n', async () => {
    const chunks = await collect(aggregate(makeStream(['para1\n\npara2']), 'paragraph'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['para1', 'para2']);
  });

  it('splits three paragraphs', async () => {
    const chunks = await collect(
      aggregate(makeStream(['first\n\nsecond\n\nthird']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['first', 'second', 'third']);
  });

  it('multi-line paragraphs', async () => {
    const chunks = await collect(
      aggregate(makeStream(['line1\nline2\n\nline3\nline4']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('line1\nline2');
    expect(contents[1]).toBe('line3\nline4');
  });

  it('paragraph boundary yields partial=false', async () => {
    const chunks = await collect(aggregate(makeStream(['para1\n\npara2']), 'paragraph'));
    expect(chunks[0].partial).toBe(false);
  });

  it('unit is "paragraph" on every chunk', async () => {
    const chunks = await collect(aggregate(makeStream(['a\n\nb\n\nc']), 'paragraph'));
    for (const c of chunks) {
      expect(c.unit).toBe('paragraph');
    }
  });

  it('indexes increment correctly', async () => {
    const chunks = await collect(aggregate(makeStream(['a\n\nb\n\nc']), 'paragraph'));
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
  });
});

// ─── 3. Windows \\r\\n\\r\\n ────────────────────────────────────────────────────

describe('Paragraph splitting — Windows \\r\\n\\r\\n', () => {
  it('splits on \\r\\n\\r\\n', async () => {
    const chunks = await collect(
      aggregate(makeStream(['para1\r\n\r\npara2']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['para1', 'para2']);
  });

  it('handles mixed \\n\\n and \\r\\n\\r\\n', async () => {
    const chunks = await collect(
      aggregate(makeStream(['first\n\nsecond\r\n\r\nthird']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['first', 'second', 'third']);
  });
});

// ─── 4. Three+ consecutive newlines ────────────────────────────────────────

describe('Paragraph splitting — three+ consecutive newlines', () => {
  it('three newlines treated as single boundary (no empty paragraph)', async () => {
    const chunks = await collect(
      aggregate(makeStream(['para1\n\n\npara2']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['para1', 'para2']);
  });

  it('four newlines treated as single boundary', async () => {
    const chunks = await collect(
      aggregate(makeStream(['para1\n\n\n\npara2']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['para1', 'para2']);
  });

  it('many newlines between paragraphs', async () => {
    const chunks = await collect(
      aggregate(makeStream(['para1\n\n\n\n\n\npara2']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['para1', 'para2']);
  });
});

// ─── 5. Newlines split across tokens ───────────────────────────────────────

describe('Paragraph splitting — newlines split across tokens', () => {
  it('\\n at end of first token, \\n at start of second', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hello\n', '\nworld']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });

  it('double newline split across three tokens', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hello', '\n', '\nworld']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });

  it('content and boundary split across many tokens', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hel', 'lo', '\n', '\n', 'wor', 'ld']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });

  it('multiple paragraphs split across tokens', async () => {
    const chunks = await collect(
      aggregate(makeStream(['first\n', '\nsecond\n', '\nthird']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['first', 'second', 'third']);
  });
});

// ─── 6. trimWhitespace option ──────────────────────────────────────────────

describe('Paragraph splitting — trimWhitespace option', () => {
  it('trimWhitespace true (default) trims trailing whitespace from paragraph content', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hello   \n\nworld']), 'paragraph'),
    );
    // aggregate itself trims, so content will be "hello"
    expect(chunks[0].content).toBe('hello');
  });

  it('trimWhitespace false preserves trailing whitespace in boundary detection', async () => {
    // With trimWhitespace false, boundaryEnd is at idx (includes trailing spaces)
    // But aggregate still trims the content, so we test the detector directly
    const result = detectParagraphBoundary('hello   \n\nworld', { trimWhitespace: false });
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(8); // "hello   " length
  });

  it('trimWhitespace true trims trailing \\r before \\n\\n', async () => {
    const result = detectParagraphBoundary('hello\r\n\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5); // trimmed \r
  });
});

// ─── 7. Single paragraph (no double newline) — flushed at stream end ──────

describe('Paragraph splitting — single paragraph', () => {
  it('single paragraph with no double newline is flushed at stream end', async () => {
    const chunks = await collect(aggregate(makeStream(['just one paragraph']), 'paragraph'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('just one paragraph');
    expect(chunks[0].partial).toBe(true);
  });

  it('single paragraph with single newline (not double) is flushed', async () => {
    const chunks = await collect(
      aggregate(makeStream(['line1\nline2\nline3']), 'paragraph'),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('line1\nline2\nline3');
    expect(chunks[0].partial).toBe(true);
  });

  it('paragraph ending with \\n\\n has no flush (all content emitted at boundary)', async () => {
    const chunks = await collect(
      aggregate(makeStream(['only paragraph\n\n']), 'paragraph'),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('only paragraph');
    expect(chunks[0].partial).toBe(false);
  });
});

// ─── 8. Empty stream ──────────────────────────────────────────────────────

describe('Paragraph splitting — empty stream', () => {
  it('empty stream produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream([]), 'paragraph'));
    expect(chunks).toHaveLength(0);
  });

  it('stream of empty strings produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream(['', '', '']), 'paragraph'));
    expect(chunks).toHaveLength(0);
  });

  it('stream of only whitespace produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream(['   ', '  ']), 'paragraph'));
    expect(chunks).toHaveLength(0);
  });

  it('stream of only newlines produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream(['\n\n\n\n']), 'paragraph'));
    expect(chunks).toHaveLength(0);
  });
});

// ─── 9. paragraphs() convenience function ─────────────────────────────────

describe('paragraphs() convenience function', () => {
  it('produces the same output as aggregate with unit "paragraph"', async () => {
    const stream1 = makeStream(['first\n\nsecond\n\nthird']);
    const stream2 = makeStream(['first\n\nsecond\n\nthird']);
    const fromAggregate = await collect(aggregate(stream1, 'paragraph'));
    const fromParagraphs = await collect(paragraphs(stream2));
    expect(fromAggregate.map(c => c.content)).toEqual(fromParagraphs.map(c => c.content));
  });

  it('unit is "paragraph" on every chunk', async () => {
    const chunks = await collect(paragraphs(makeStream(['a\n\nb\n\nc'])));
    for (const c of chunks) {
      expect(c.unit).toBe('paragraph');
    }
  });

  it('indexes increment correctly', async () => {
    const chunks = await collect(paragraphs(makeStream(['a\n\nb\n\nc'])));
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
  });

  it('accepts options', async () => {
    const chunks = await collect(
      paragraphs(makeStream(['first\n\nsecond']), { flush: 'discard' }),
    );
    // "second" is discarded since no boundary follows it
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('first');
  });
});

// ─── 10. Flush modes ──────────────────────────────────────────────────────

describe('Paragraph splitting — flush modes', () => {
  it('flush="emit" (default) emits remaining paragraph', async () => {
    const chunks = await collect(
      aggregate(makeStream(['para1\n\npara2']), 'paragraph'),
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[1].content).toBe('para2');
  });

  it('flush="discard" discards incomplete paragraph', async () => {
    const chunks = await collect(
      aggregate(makeStream(['para1\n\npara2']), 'paragraph', { flush: 'discard' }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('para1');
  });

  it('flush="discard" still emits complete paragraphs', async () => {
    const chunks = await collect(
      aggregate(makeStream(['para1\n\npara2\n\n']), 'paragraph', { flush: 'discard' }),
    );
    expect(chunks).toHaveLength(2);
  });
});

// ─── 11. Edge cases ───────────────────────────────────────────────────────

describe('Paragraph splitting — edge cases', () => {
  it('double newline at very start of stream', async () => {
    const chunks = await collect(
      aggregate(makeStream(['\n\nhello']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello']);
  });

  it('double newline at very end of stream', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hello\n\n']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello']);
  });

  it('single-character tokens building paragraphs', async () => {
    const chars = 'ab\n\ncd'.split('');
    const chunks = await collect(aggregate(makeStream(chars), 'paragraph'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['ab', 'cd']);
  });

  it('paragraphs with leading/trailing whitespace are trimmed', async () => {
    const chunks = await collect(
      aggregate(makeStream(['  hello  \n\n  world  ']), 'paragraph'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('hello');
    expect(contents[1]).toBe('world');
  });
});
