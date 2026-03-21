import { describe, it, expect } from 'vitest';
import { aggregate, lines, detectLineBoundary } from '../index';
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

// ─── 1. detectLineBoundary unit tests ────────────────────────────────────────

describe('detectLineBoundary — direct', () => {
  it('returns null for empty string', () => {
    expect(detectLineBoundary('', {})).toBeNull();
  });

  it('returns null when no newline in buffer', () => {
    expect(detectLineBoundary('hello world', {})).toBeNull();
  });

  it('detects boundary on \\n', () => {
    const result = detectLineBoundary('hello\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5);
    expect(result!.nextStart).toBe(6);
  });

  it('handles \\r\\n — strips \\r from content', () => {
    const result = detectLineBoundary('hello\r\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5); // ends before \r
    expect(result!.nextStart).toBe(7);   // starts after \n
  });

  it('handles empty line (consecutive \\n)', () => {
    const result = detectLineBoundary('\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(0);
    expect(result!.nextStart).toBe(1);
  });

  it('includeNewline includes \\n in boundaryEnd', () => {
    const result = detectLineBoundary('hello\nworld', { includeNewline: true });
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(6); // includes the \n
    expect(result!.nextStart).toBe(6);
  });

  it('includeNewline with \\r\\n includes \\n but content still starts after \\r\\n', () => {
    const result = detectLineBoundary('hello\r\nworld', { includeNewline: true });
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(7); // includes up to and including \n
    expect(result!.nextStart).toBe(7);
  });

  it('skipEmpty skips empty lines and returns next non-empty boundary', () => {
    const result = detectLineBoundary('\n\nhello\nworld', { skipEmpty: true });
    expect(result).not.toBeNull();
    // Should skip the two empty lines and find "hello\n"
    expect(result!.contentStart).toBe(2); // content starts at index 2
    expect(result!.boundaryEnd).toBe(7);  // "hello" ends at index 7
    expect(result!.nextStart).toBe(8);    // after the \n
  });

  it('skipEmpty with only empty lines returns boundary to consume them', () => {
    const result = detectLineBoundary('\n\n\n', { skipEmpty: true });
    expect(result).not.toBeNull();
    // Should consume all empty lines
    expect(result!.boundaryEnd).toBe(0);
    expect(result!.nextStart).toBe(3);
  });
});

// ─── 2. Basic line splitting ─────────────────────────────────────────────────

describe('Line splitting — basic', () => {
  it('splits "line1\\nline2\\nline3" into three lines', async () => {
    const chunks = await collect(aggregate(makeStream(['line1\nline2\nline3']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['line1', 'line2', 'line3']);
  });

  it('splits single newline into one line plus flush', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\n']), 'line'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('hello');
    expect(chunks[0].partial).toBe(false);
  });

  it('handles multiple newlines in single token', async () => {
    const chunks = await collect(aggregate(makeStream(['a\nb\nc\n']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['a', 'b', 'c']);
  });
});

// ─── 3. Windows newlines \\r\\n ───────────────────────────────────────────────

describe('Line splitting — Windows newlines \\r\\n', () => {
  it('strips \\r from line content', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\r\nworld\r\n']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });

  it('handles \\r\\n split across tokens', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\r', '\nworld']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });

  it('handles mixed \\n and \\r\\n', async () => {
    const chunks = await collect(aggregate(makeStream(['line1\nline2\r\nline3\n']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['line1', 'line2', 'line3']);
  });
});

// ─── 4. Empty lines ──────────────────────────────────────────────────────────

describe('Line splitting — empty lines', () => {
  it('consecutive newlines skip empty content in aggregate (trimmed empty)', async () => {
    const chunks = await collect(aggregate(makeStream(['line1\n\nline2']), 'line'));
    const contents = chunks.map(c => c.content);
    // aggregate trims content and skips empty — so the empty line between is skipped
    expect(contents).toEqual(['line1', 'line2']);
  });

  it('multiple consecutive newlines only produce non-empty lines', async () => {
    const chunks = await collect(aggregate(makeStream(['a\n\n\n\nb']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['a', 'b']);
  });
});

// ─── 5. No trailing newline at stream end ────────────────────────────────────

describe('Line splitting — no trailing newline', () => {
  it('content without trailing \\n is flushed', async () => {
    const chunks = await collect(aggregate(makeStream(['hello']), 'line'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('hello');
    // line flush is always partial: false
    expect(chunks[0].partial).toBe(false);
  });

  it('last line without \\n is flushed after earlier lines', async () => {
    const chunks = await collect(aggregate(makeStream(['line1\nline2']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['line1', 'line2']);
  });

  it('stream ending with \\n does not produce extra chunk', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\n']), 'line'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('hello');
  });
});

// ─── 6. Multiple newlines split across tokens ────────────────────────────────

describe('Line splitting — newlines split across tokens', () => {
  it('newline at start of second token', async () => {
    const chunks = await collect(aggregate(makeStream(['hello', '\nworld']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });

  it('newline at end of first token', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\n', 'world']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });

  it('content split across many tokens with newlines', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hel', 'lo\nwor', 'ld\nfoo']), 'line'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world', 'foo']);
  });
});

// ─── 7. Single-character tokens accumulating ─────────────────────────────────

describe('Line splitting — single-character tokens', () => {
  it('builds lines from individual characters', async () => {
    const chars = 'hello\nworld\n'.split('');
    const chunks = await collect(aggregate(makeStream(chars), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });

  it('single newline character yields nothing (empty line trimmed away)', async () => {
    const chunks = await collect(aggregate(makeStream(['\n']), 'line'));
    expect(chunks).toHaveLength(0);
  });

  it('multiple single-char tokens forming lines', async () => {
    const chars = 'a\nb\nc'.split('');
    const chunks = await collect(aggregate(makeStream(chars), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['a', 'b', 'c']);
  });
});

// ─── 8. Content with mixed \\n and \\r\\n ─────────────────────────────────────

describe('Line splitting — mixed newline styles', () => {
  it('handles alternating \\n and \\r\\n', async () => {
    const chunks = await collect(
      aggregate(makeStream(['first\nsecond\r\nthird\nfourth\r\n']), 'line'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('\\r without following \\n is kept in content', async () => {
    // bare \r is not a newline — only \r\n is treated as newline
    const chunks = await collect(aggregate(makeStream(['hello\rworld\n']), 'line'));
    expect(chunks).toHaveLength(1);
    // aggregate trims, and the content is "hello\rworld" which trim does not remove \r in the middle
    expect(chunks[0].content).toBe('hello\rworld');
  });
});

// ─── 9. Stream ending with \\n vs without ────────────────────────────────────

describe('Line splitting — stream end behavior', () => {
  it('stream ending with \\n: no partial chunk', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\nworld\n']), 'line'));
    for (const c of chunks) {
      expect(c.partial).toBe(false);
    }
  });

  it('stream ending without \\n: last line flushed as partial=false for line unit', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\nworld']), 'line'));
    const last = chunks[chunks.length - 1];
    expect(last.content).toBe('world');
    // isPartial returns false for 'line' unit
    expect(last.partial).toBe(false);
  });
});

// ─── 10. skipEmpty option ────────────────────────────────────────────────────

describe('Line splitting — skipEmpty option', () => {
  it('skipEmpty skips blank lines between content lines', async () => {
    const chunks = await collect(
      aggregate(makeStream(['line1\n\n\nline2\n']), 'line', { skipEmpty: true }),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['line1', 'line2']);
  });

  it('skipEmpty with all empty lines produces no chunks', async () => {
    const chunks = await collect(
      aggregate(makeStream(['\n\n\n']), 'line', { skipEmpty: true }),
    );
    expect(chunks).toHaveLength(0);
  });

  it('skipEmpty with mixed content and empty lines', async () => {
    const chunks = await collect(
      aggregate(makeStream(['a\n\nb\n\n\nc\n']), 'line', { skipEmpty: true }),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['a', 'b', 'c']);
  });

  it('skipEmpty false (default) includes empty lines in boundary detection', async () => {
    // With default skipEmpty=false, empty lines are still skipped by aggregate
    // because aggregate trims content and skips empty strings.
    // This is aggregate-level behavior, not detector-level.
    const chunks = await collect(
      aggregate(makeStream(['line1\n\nline2\n']), 'line'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['line1', 'line2']);
  });
});

// ─── 11. includeNewline option ───────────────────────────────────────────────

describe('Line splitting — includeNewline option (detector level)', () => {
  it('includeNewline=true sets boundaryEnd past the \\n', () => {
    const result = detectLineBoundary('hello\nworld', { includeNewline: true });
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(6);
    // Slicing with this gives "hello\n"
    expect('hello\nworld'.slice(0, result!.boundaryEnd)).toBe('hello\n');
  });

  it('includeNewline=false (default) sets boundaryEnd before \\n', () => {
    const result = detectLineBoundary('hello\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5);
    expect('hello\nworld'.slice(0, result!.boundaryEnd)).toBe('hello');
  });

  it('includeNewline through aggregate — aggregate trims so newline is stripped', async () => {
    // Even with includeNewline, aggregate().trim() strips trailing \n
    const chunks = await collect(
      aggregate(makeStream(['hello\nworld\n']), 'line', { includeNewline: true }),
    );
    const contents = chunks.map(c => c.content);
    // Content is trimmed, so newline is not visible in output
    expect(contents).toEqual(['hello', 'world']);
  });
});

// ─── 12. lines() convenience function ────────────────────────────────────────

describe('lines() convenience function', () => {
  it('produces the same output as aggregate with unit "line"', async () => {
    const stream1 = makeStream(['hello\nworld\nfoo']);
    const stream2 = makeStream(['hello\nworld\nfoo']);
    const fromAggregate = await collect(aggregate(stream1, 'line'));
    const fromLines = await collect(lines(stream2));
    expect(fromAggregate.map(c => c.content)).toEqual(fromLines.map(c => c.content));
  });

  it('unit is "line" on every chunk', async () => {
    const chunks = await collect(lines(makeStream(['one\ntwo\nthree\n'])));
    for (const c of chunks) {
      expect(c.unit).toBe('line');
    }
  });

  it('indexes increment correctly', async () => {
    const chunks = await collect(lines(makeStream(['a\nb\nc\n'])));
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
  });

  it('accepts options', async () => {
    const chunks = await collect(
      lines(makeStream(['a\n\nb\n']), { skipEmpty: true }),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['a', 'b']);
  });
});

// ─── 13. Flush modes with line unit ──────────────────────────────────────────

describe('Line splitting — flush modes', () => {
  it('flush="emit" (default) emits remaining buffer', async () => {
    const chunks = await collect(aggregate(makeStream(['hello']), 'line'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('hello');
  });

  it('flush="discard" discards remaining buffer', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hello']), 'line', { flush: 'discard' }),
    );
    expect(chunks).toHaveLength(0);
  });

  it('flush="discard" still emits complete lines', async () => {
    const chunks = await collect(
      aggregate(makeStream(['line1\npartial']), 'line', { flush: 'discard' }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('line1');
  });
});

// ─── 14. Edge cases ──────────────────────────────────────────────────────────

describe('Line splitting — edge cases', () => {
  it('empty stream produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream([]), 'line'));
    expect(chunks).toHaveLength(0);
  });

  it('stream of empty strings produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream(['', '', '']), 'line'));
    expect(chunks).toHaveLength(0);
  });

  it('only newlines produce no content chunks', async () => {
    const chunks = await collect(aggregate(makeStream(['\n\n\n']), 'line'));
    expect(chunks).toHaveLength(0);
  });

  it('very long line without newline is flushed', async () => {
    const longLine = 'a'.repeat(10000);
    const chunks = await collect(aggregate(makeStream([longLine]), 'line'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(longLine);
  });

  it('whitespace-only lines are trimmed away by aggregate', async () => {
    const chunks = await collect(aggregate(makeStream(['  \n  \nhello\n']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello']);
  });
});
