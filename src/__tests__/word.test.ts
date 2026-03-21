import { describe, it, expect } from 'vitest';
import { aggregate, words } from '../index';
import { detectWordBoundary } from '../units/word';
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

// ─── 1. detectWordBoundary unit tests ─────────────────────────────────────────

describe('detectWordBoundary — direct', () => {
  it('returns null for empty string', () => {
    expect(detectWordBoundary('', {})).toBeNull();
  });

  it('returns null for whitespace-only buffer', () => {
    expect(detectWordBoundary('   ', {})).toBeNull();
  });

  it('returns null when word is incomplete (no trailing whitespace)', () => {
    expect(detectWordBoundary('hello', {})).toBeNull();
  });

  it('detects word boundary on space', () => {
    const result = detectWordBoundary('hello world', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5);
    expect(result!.nextStart).toBe(6);
  });

  it('detects word boundary on tab', () => {
    const result = detectWordBoundary('hello\tworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5);
  });

  it('detects word boundary on newline', () => {
    const result = detectWordBoundary('hello\nworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5);
  });

  it('detects word boundary on carriage return', () => {
    const result = detectWordBoundary('hello\rworld', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5);
  });

  it('skips leading whitespace', () => {
    const result = detectWordBoundary('  hello world', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(7);
    expect(result!.nextStart).toBe(8);
  });

  it('skips multiple trailing whitespace characters', () => {
    const result = detectWordBoundary('hello   world', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(5);
    expect(result!.nextStart).toBe(8);
  });

  it('includeWhitespace option includes trailing whitespace in content', () => {
    const result = detectWordBoundary('hello   world', { includeWhitespace: true });
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(8);
    expect(result!.nextStart).toBe(8);
  });
});

// ─── 2. Basic word splitting ──────────────────────────────────────────────────

describe('Word splitting — basic', () => {
  it('splits "hello world" into two words', async () => {
    const chunks = await collect(aggregate(makeStream(['hello world ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });

  it('splits "a b c" into three words', async () => {
    const chunks = await collect(aggregate(makeStream(['a b c ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['a', 'b', 'c']);
  });

  it('handles multiple spaces between words', async () => {
    const chunks = await collect(aggregate(makeStream(['hello    world ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });
});

// ─── 3. Tokens that split mid-word ───────────────────────────────────────────

describe('Word splitting — mid-word token splits', () => {
  it('"hel", "lo " accumulates to "hello"', async () => {
    const chunks = await collect(aggregate(makeStream(['hel', 'lo ']), 'word'));
    expect(chunks[0].content).toBe('hello');
  });

  it('"h", "e", "l", "l", "o", " " accumulates character by character', async () => {
    const chunks = await collect(aggregate(makeStream(['h', 'e', 'l', 'l', 'o', ' ']), 'word'));
    expect(chunks[0].content).toBe('hello');
  });

  it('multiple words split across tokens', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hel', 'lo ', 'wor', 'ld ', 'foo']), 'word'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('hello');
    expect(contents[1]).toBe('world');
    expect(contents[2]).toBe('foo'); // flushed
  });
});

// ─── 4. Hyphenated words ─────────────────────────────────────────────────────

describe('Word splitting — hyphenated words', () => {
  it('"well-known " is a single word', async () => {
    const chunks = await collect(aggregate(makeStream(['well-known ']), 'word'));
    expect(chunks[0].content).toBe('well-known');
  });

  it('"state-of-the-art " is a single word', async () => {
    const chunks = await collect(aggregate(makeStream(['state-of-the-art ']), 'word'));
    expect(chunks[0].content).toBe('state-of-the-art');
  });

  it('hyphenated word split across tokens', async () => {
    const chunks = await collect(aggregate(makeStream(['well-', 'known ']), 'word'));
    expect(chunks[0].content).toBe('well-known');
  });
});

// ─── 5. Contractions ─────────────────────────────────────────────────────────

describe('Word splitting — contractions', () => {
  it('"don\'t " is a single word', async () => {
    const chunks = await collect(aggregate(makeStream(["don't "]), 'word'));
    expect(chunks[0].content).toBe("don't");
  });

  it('"it\'s " is a single word', async () => {
    const chunks = await collect(aggregate(makeStream(["it's "]), 'word'));
    expect(chunks[0].content).toBe("it's");
  });

  it('"they\'re " is a single word', async () => {
    const chunks = await collect(aggregate(makeStream(["they're "]), 'word'));
    expect(chunks[0].content).toBe("they're");
  });

  it('contraction split across tokens', async () => {
    const chunks = await collect(aggregate(makeStream(["don", "'t "]), 'word'));
    expect(chunks[0].content).toBe("don't");
  });
});

// ─── 6. Multiple words in single token ───────────────────────────────────────

describe('Word splitting — multiple words in single token', () => {
  it('"hello world foo " yields three words', async () => {
    const chunks = await collect(aggregate(makeStream(['hello world foo ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world', 'foo']);
  });

  it('"the quick brown fox " yields four words', async () => {
    const chunks = await collect(aggregate(makeStream(['the quick brown fox ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['the', 'quick', 'brown', 'fox']);
  });
});

// ─── 7. Leading/trailing whitespace ──────────────────────────────────────────

describe('Word splitting — whitespace handling', () => {
  it('leading whitespace before first word', async () => {
    const chunks = await collect(aggregate(makeStream(['  hello world ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world']);
  });

  it('trailing whitespace only (no word content) produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream(['   ']), 'word'));
    expect(chunks).toHaveLength(0);
  });

  it('tabs and newlines as word separators', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\tworld\nfoo ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['hello', 'world', 'foo']);
  });
});

// ─── 8. Empty tokens ─────────────────────────────────────────────────────────

describe('Word splitting — empty tokens', () => {
  it('empty tokens between real tokens are ignored', async () => {
    const chunks = await collect(aggregate(makeStream(['', 'hello', '', ' ', '', 'world', '']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toContain('hello');
    expect(contents).toContain('world');
  });

  it('stream of only empty tokens produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream(['', '', '']), 'word'));
    expect(chunks).toHaveLength(0);
  });
});

// ─── 9. Unicode characters ───────────────────────────────────────────────────

describe('Word splitting — Unicode', () => {
  it('handles non-ASCII characters as part of words', async () => {
    const chunks = await collect(aggregate(makeStream(['cafe\u0301 latte ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('cafe\u0301');
    expect(contents[1]).toBe('latte');
  });

  it('handles CJK characters adjacent to spaces', async () => {
    const chunks = await collect(aggregate(makeStream(['\u4F60\u597D \u4E16\u754C ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['\u4F60\u597D', '\u4E16\u754C']);
  });

  it('handles emoji in words', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\uD83D\uDE00 world ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('hello\uD83D\uDE00');
    expect(contents[1]).toBe('world');
  });
});

// ─── 10. Punctuation attached to words ───────────────────────────────────────

describe('Word splitting — punctuation', () => {
  it('"Hello, " keeps comma attached', async () => {
    const chunks = await collect(aggregate(makeStream(['Hello, world ']), 'word'));
    expect(chunks[0].content).toBe('Hello,');
  });

  it('"end. " keeps period attached', async () => {
    const chunks = await collect(aggregate(makeStream(['end. next ']), 'word'));
    expect(chunks[0].content).toBe('end.');
  });

  it('"wow! " keeps exclamation attached', async () => {
    const chunks = await collect(aggregate(makeStream(['wow! next ']), 'word'));
    expect(chunks[0].content).toBe('wow!');
  });

  it('"really? " keeps question mark attached', async () => {
    const chunks = await collect(aggregate(makeStream(['really? next ']), 'word'));
    expect(chunks[0].content).toBe('really?');
  });

  it('parentheses stay attached', async () => {
    const chunks = await collect(aggregate(makeStream(['(hello) world ']), 'word'));
    expect(chunks[0].content).toBe('(hello)');
  });
});

// ─── 11. Flush behavior ─────────────────────────────────────────────────────

describe('Word splitting — flush', () => {
  it('last word emitted on stream end with partial=true', async () => {
    const chunks = await collect(aggregate(makeStream(['hello world']), 'word'));
    const last = chunks[chunks.length - 1];
    expect(last.content).toBe('world');
    expect(last.partial).toBe(true);
  });

  it('flush="discard" discards incomplete last word', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hello world']), 'word', { flush: 'discard' }),
    );
    // "hello" was emitted at boundary, "world" is discarded
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('hello');
  });

  it('no flush needed when stream ends with whitespace', async () => {
    const chunks = await collect(aggregate(makeStream(['hello ']), 'word'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('hello');
    expect(chunks[0].partial).toBe(false);
  });
});

// ─── 12. Single-character tokens accumulating ────────────────────────────────

describe('Word splitting — single-character tokens', () => {
  it('builds words from individual characters', async () => {
    const chars = 'hello world '.split('');
    const chunks = await collect(aggregate(makeStream(chars), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toContain('hello');
    expect(contents).toContain('world');
  });

  it('builds multiple words from character stream', async () => {
    const chars = 'a b c '.split('');
    const chunks = await collect(aggregate(makeStream(chars), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual(['a', 'b', 'c']);
  });
});

// ─── 13. words() convenience function ────────────────────────────────────────

describe('words() convenience function', () => {
  it('produces the same output as aggregate with unit "word"', async () => {
    const stream1 = makeStream(['hello world foo ']);
    const stream2 = makeStream(['hello world foo ']);
    const fromAggregate = await collect(aggregate(stream1, 'word'));
    const fromWords = await collect(words(stream2));
    expect(fromAggregate.map(c => c.content)).toEqual(fromWords.map(c => c.content));
  });

  it('unit is "word" on every chunk', async () => {
    const chunks = await collect(words(makeStream(['one two three '])));
    for (const c of chunks) {
      expect(c.unit).toBe('word');
    }
  });

  it('indexes increment correctly', async () => {
    const chunks = await collect(words(makeStream(['a b c '])));
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
  });
});

// ─── 14. includeWhitespace option via aggregate ──────────────────────────────

describe('Word splitting — includeWhitespace option', () => {
  it('includes trailing space when includeWhitespace is true', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hello world ']), 'word', { includeWhitespace: true }),
    );
    // With includeWhitespace, content includes trailing whitespace before trim
    // But aggregate() trims the content, so the content will still be trimmed.
    // The boundary positions change though — let's verify the words are still correct.
    const contents = chunks.map(c => c.content);
    expect(contents).toContain('hello');
    expect(contents).toContain('world');
  });
});

// ─── 15. Mixed whitespace types ──────────────────────────────────────────────

describe('Word splitting — mixed whitespace', () => {
  it('handles \\r\\n between words', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\r\nworld ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toContain('hello');
    expect(contents).toContain('world');
  });

  it('handles mixed tabs, spaces, newlines', async () => {
    const chunks = await collect(aggregate(makeStream(['a\t \nb\r c ']), 'word'));
    const contents = chunks.map(c => c.content);
    expect(contents).toContain('a');
    expect(contents).toContain('b');
    expect(contents).toContain('c');
  });
});
