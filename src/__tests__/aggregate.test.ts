import { describe, it, expect, vi } from 'vitest';
import { aggregate, sentences, words } from '../index';
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

// ─── 1. Empty stream ────────────────────────────────────────────────────────

describe('Empty stream', () => {
  it('emits no chunks', async () => {
    const chunks = await collect(aggregate(makeStream([]), 'word'));
    expect(chunks).toHaveLength(0);
  });
});

// ─── 2. Single token no boundary (word mode) ────────────────────────────────

describe('Single token no boundary', () => {
  it('flush emits with partial=true', async () => {
    const chunks = await collect(aggregate(makeStream(['hello']), 'word'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('hello');
    expect(chunks[0].partial).toBe(true);
  });
});

// ─── 3. Word mode: split on spaces ──────────────────────────────────────────

describe('Word mode', () => {
  it('splits "hello world foo" correctly', async () => {
    const chunks = await collect(aggregate(makeStream(['hello world foo']), 'word'));
    const words = chunks.map(c => c.content);
    expect(words).toContain('hello');
    expect(words).toContain('world');
    // "foo" may be a partial flush
    const fooChunk = chunks.find(c => c.content === 'foo');
    expect(fooChunk).toBeDefined();
  });

  it('single token "hello " → chunk hello emitted, no flush needed', async () => {
    const chunks = await collect(aggregate(makeStream(['hello ']), 'word'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('hello');
    expect(chunks[0].partial).toBe(false);
  });

  it('handles multiple tokens forming words', async () => {
    const chunks = await collect(aggregate(makeStream(['hel', 'lo ', 'wor', 'ld']), 'word'));
    expect(chunks[0].content).toBe('hello');
    // "world" is flushed as partial
    const worldChunk = chunks.find(c => c.content === 'world');
    expect(worldChunk).toBeDefined();
  });

  it('unit is "word" on every chunk', async () => {
    const chunks = await collect(aggregate(makeStream(['a b c']), 'word'));
    for (const c of chunks) {
      expect(c.unit).toBe('word');
    }
  });
});

// ─── 4. Line mode ───────────────────────────────────────────────────────────

describe('Line mode', () => {
  it('splits on newlines and flushes last line', async () => {
    const chunks = await collect(aggregate(makeStream(['line1\nline2\nline3']), 'line'));
    const contents = chunks.map(c => c.content);
    expect(contents).toContain('line1');
    expect(contents).toContain('line2');
    expect(contents).toContain('line3');
  });

  it('each chunk has correct incrementing index', async () => {
    const chunks = await collect(aggregate(makeStream(['a\nb\nc']), 'line'));
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
  });

  it('partial=false for lines split on newline', async () => {
    const chunks = await collect(aggregate(makeStream(['line1\nline2\n']), 'line'));
    const line1 = chunks.find(c => c.content === 'line1');
    expect(line1?.partial).toBe(false);
  });
});

// ─── 5. Paragraph mode ──────────────────────────────────────────────────────

describe('Paragraph mode', () => {
  it('splits on double newline', async () => {
    const chunks = await collect(aggregate(makeStream(['para1\n\npara2']), 'paragraph'));
    const para1 = chunks.find(c => c.content === 'para1');
    expect(para1).toBeDefined();
    expect(para1?.partial).toBe(false);
  });

  it('flushes last paragraph', async () => {
    const chunks = await collect(aggregate(makeStream(['para1\n\npara2']), 'paragraph'));
    const para2 = chunks.find(c => c.content === 'para2');
    expect(para2).toBeDefined();
  });

  it('handles tokens split across double newline', async () => {
    const chunks = await collect(aggregate(makeStream(['hello\n', '\nworld']), 'paragraph'));
    const hello = chunks.find(c => c.content === 'hello');
    expect(hello).toBeDefined();
  });
});

// ─── 6. Sentence mode ───────────────────────────────────────────────────────

describe('Sentence mode', () => {
  it('splits "Hello world. How are you?" into two sentences', async () => {
    const chunks = await collect(aggregate(makeStream(['Hello world. How are you?']), 'sentence'));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const first = chunks[0].content;
    expect(first).toMatch(/Hello world\./);
  });

  it('abbreviation "Dr. Smith went home. Good." → two sentences', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Dr. Smith went home. Good.']), 'sentence'),
    );
    // Should produce 2 sentences, not 3
    expect(chunks.length).toBeLessThanOrEqual(2);
    // First sentence should include "Dr. Smith went home."
    const joined = chunks.map(c => c.content).join(' ');
    expect(joined).toContain('Dr. Smith went home.');
  });

  it('does not split on decimal numbers', async () => {
    const chunks = await collect(
      aggregate(makeStream(['The value is 3.14 exactly. Done.']), 'sentence'),
    );
    // "3.14" should not be a split point
    const first = chunks[0].content;
    expect(first).toContain('3.14');
  });
});

// ─── 7. JSON mode ───────────────────────────────────────────────────────────

describe('JSON mode', () => {
  it('emits two JSON objects from consecutive JSON', async () => {
    const chunks = await collect(
      aggregate(makeStream(['{"a":1}{"b":2}']), 'json'),
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe('{"a":1}');
    expect(chunks[1].content).toBe('{"b":2}');
  });

  it('handles nested JSON correctly', async () => {
    const chunks = await collect(
      aggregate(makeStream(['{"a":{"b":1}}']), 'json'),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('{"a":{"b":1}}');
    expect(chunks[0].partial).toBe(false);
  });

  it('handles JSON string containing braces', async () => {
    const chunks = await collect(
      aggregate(makeStream(['{"a":"{fake}"}']), 'json'),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('{"a":"{fake}"}');
  });

  it('sets metadata.type to "object" for objects', async () => {
    const chunks = await collect(aggregate(makeStream(['{"x":1}']), 'json'));
    expect(chunks[0].metadata?.type).toBe('object');
  });

  it('sets metadata.type to "array" for arrays', async () => {
    const chunks = await collect(aggregate(makeStream(['[1,2,3]']), 'json'));
    expect(chunks[0].metadata?.type).toBe('array');
  });

  it('ignores preamble text before JSON', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Here is the result: {"name":"Alice"}']), 'json'),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('{"name":"Alice"}');
  });
});

// ─── 8. Code-block mode ─────────────────────────────────────────────────────

describe('Code-block mode', () => {
  it('emits one chunk with metadata.language="js"', async () => {
    const input = '```js\nconsole.log(\'hi\');\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata?.language).toBe('js');
    expect(chunks[0].partial).toBe(false);
  });

  it('captures fenceLength correctly', async () => {
    const input = '```python\nprint("hello")\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks[0].metadata?.fenceLength).toBe(3);
  });

  it('handles code block with no language tag', async () => {
    const input = '```\ncode here\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata?.language).toBeUndefined();
  });

  it('emits partial=true for unclosed code block', async () => {
    const input = '```js\nconsole.log("hi");';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].partial).toBe(true);
  });
});

// ─── 9. Flush behavior ──────────────────────────────────────────────────────

describe('Flush behavior', () => {
  it('flush="discard" discards remaining buffer', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hello']), 'word', { flush: 'discard' }),
    );
    expect(chunks).toHaveLength(0);
  });

  it('flush="callback" calls onFlush with remaining content', async () => {
    const onFlush = vi.fn();
    const chunks = await collect(
      aggregate(makeStream(['hello']), 'word', { flush: 'callback', onFlush }),
    );
    expect(chunks).toHaveLength(0);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith('hello', 'word');
  });

  it('flush="emit" (default) emits remaining buffer as partial chunk', async () => {
    const chunks = await collect(
      aggregate(makeStream(['hello']), 'word', { flush: 'emit' }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].partial).toBe(true);
    expect(chunks[0].content).toBe('hello');
  });
});

// ─── 10. Custom detector ────────────────────────────────────────────────────

describe('Custom detector', () => {
  it('splits on "---" separator', async () => {
    const detect = (buffer: string) => {
      const idx = buffer.indexOf('---');
      if (idx === -1) return null;
      return { boundaryEnd: idx, nextStart: idx + 3 };
    };
    const chunks = await collect(
      aggregate(makeStream(['first---second---third']), 'custom', { detect }),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toContain('first');
    expect(contents).toContain('second');
  });
});

// ─── 11. Index increments ───────────────────────────────────────────────────

describe('Index increments correctly', () => {
  it('indexes are 0, 1, 2 for three chunks', async () => {
    const chunks = await collect(aggregate(makeStream(['a\nb\nc']), 'line'));
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
  });
});

// ─── 12. Convenience functions ──────────────────────────────────────────────

describe('Convenience functions', () => {
  it('sentences() works', async () => {
    const chunks = await collect(sentences(makeStream(['Hello. World.'])));
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].unit).toBe('sentence');
  });

  it('words() works', async () => {
    const chunks = await collect(words(makeStream(['hello world'])));
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].unit).toBe('word');
  });
});

// ─── 12b. trimWhitespace: false preserves whitespace ────────────────────────

describe('trimWhitespace: false', () => {
  it('preserves leading/trailing whitespace in line mode', async () => {
    const chunks = await collect(
      aggregate(makeStream(['  hello  \n  world  \n']), 'line', { trimWhitespace: false }),
    );
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Content should NOT be trimmed — leading/trailing spaces preserved
    expect(chunks[0].content).toContain('  hello  ');
  });

  it('default behavior still trims whitespace', async () => {
    const chunks = await collect(
      aggregate(makeStream(['  hello  \n  world  \n']), 'line'),
    );
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toBe('hello');
  });
});

// ─── 13. maxBufferSize ──────────────────────────────────────────────────────

describe('maxBufferSize', () => {
  it('forces emit with partial=true when buffer exceeds limit', async () => {
    const bigToken = 'a'.repeat(100);
    const chunks = await collect(
      aggregate(makeStream([bigToken]), 'sentence', { maxBufferSize: 50 }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].partial).toBe(true);
    expect(chunks[0].content.length).toBe(100);
  });
});
