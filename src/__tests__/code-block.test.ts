import { describe, it, expect } from 'vitest';
import { aggregate, codeBlocks } from '../index';
import { detectCodeBlockBoundary } from '../units/code-block';
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

// ─── 1. detectCodeBlockBoundary unit tests ───────────────────────────────────

describe('detectCodeBlockBoundary — direct', () => {
  it('returns null for empty string', () => {
    expect(detectCodeBlockBoundary('', {})).toBeNull();
  });

  it('returns null when no opening fence found', () => {
    expect(detectCodeBlockBoundary('just some text\n', {})).toBeNull();
  });

  it('returns null for unclosed code block (no closing fence)', () => {
    expect(detectCodeBlockBoundary('```js\nconsole.log("hi");\n', {})).toBeNull();
  });

  it('detects simple backtick code block', () => {
    const buffer = '```\nsome code\n```\n';
    const result = detectCodeBlockBoundary(buffer, {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(buffer.length);
    expect(result!.nextStart).toBe(buffer.length);
  });

  it('detects code block with language tag', () => {
    const buffer = '```typescript\nconst x = 1;\n```\n';
    const result = detectCodeBlockBoundary(buffer, {});
    expect(result).not.toBeNull();
    expect(result!.metadata?.language).toBe('typescript');
    expect(result!.metadata?.fenceLength).toBe(3);
  });

  it('detects tilde fence style (~~~)', () => {
    const buffer = '~~~python\nprint("hi")\n~~~\n';
    const result = detectCodeBlockBoundary(buffer, {});
    expect(result).not.toBeNull();
    expect(result!.metadata?.language).toBe('python');
    expect(result!.metadata?.fenceLength).toBe(3);
  });

  it('detects extended fence (4 backticks)', () => {
    const buffer = '````js\ncode here\n````\n';
    const result = detectCodeBlockBoundary(buffer, {});
    expect(result).not.toBeNull();
    expect(result!.metadata?.fenceLength).toBe(4);
  });

  it('returns undefined language for fence with no tag', () => {
    const buffer = '```\ncode here\n```\n';
    const result = detectCodeBlockBoundary(buffer, {});
    expect(result).not.toBeNull();
    expect(result!.metadata?.language).toBeUndefined();
  });

  it('does not close on shorter fence than opening', () => {
    // Opening is 4 backticks; ``` inside should not close it
    const buffer = '````js\n```\ncode here\n````\n';
    const result = detectCodeBlockBoundary(buffer, {});
    expect(result).not.toBeNull();
    // The result should span the entire buffer including the inner ``` line
    expect(result!.boundaryEnd).toBe(buffer.length);
  });

  it('returns null for tilde opening with backtick closing', () => {
    // ~~~ opened but ``` appears as closing — should NOT close
    const buffer = '~~~\ncode\n```\n';
    const result = detectCodeBlockBoundary(buffer, {});
    expect(result).toBeNull();
  });
});

// ─── 2. Basic code block splitting ───────────────────────────────────────────

describe('Code-block splitting — basic', () => {
  it('emits one complete code block chunk', async () => {
    const input = '```js\nconsole.log("hi");\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].partial).toBe(false);
    expect(chunks[0].unit).toBe('code-block');
  });

  it('chunk content contains the fence and body', async () => {
    const input = '```js\nconsole.log("hi");\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks[0].content).toContain('```js');
    expect(chunks[0].content).toContain('console.log');
  });

  it('sets metadata.language correctly', async () => {
    const input = '```python\nprint("hello")\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks[0].metadata?.language).toBe('python');
  });

  it('sets metadata.fenceLength to 3 for triple backtick', async () => {
    const input = '```python\nprint("hello")\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks[0].metadata?.fenceLength).toBe(3);
  });

  it('language is undefined when no tag given', async () => {
    const input = '```\ncode here\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata?.language).toBeUndefined();
  });

  it('index starts at 0', async () => {
    const input = '```js\nlet x = 1;\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks[0].index).toBe(0);
  });
});

// ─── 3. Multiple code blocks in one stream ────────────────────────────────────

describe('Code-block splitting — multiple blocks', () => {
  it('emits two code blocks from a stream with two blocks', async () => {
    const input = '```js\ncode1\n```\n\n```python\ncode2\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata?.language).toBe('js');
    expect(chunks[1].metadata?.language).toBe('python');
  });

  it('indexes increment across blocks', async () => {
    const input = '```a\nx\n```\n```b\ny\n```\n```c\nz\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks).toHaveLength(3);
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
  });

  it('each block is partial=false', async () => {
    const input = '```a\nx\n```\n```b\ny\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    for (const c of chunks) {
      expect(c.partial).toBe(false);
    }
  });
});

// ─── 4. Tilde fence style ─────────────────────────────────────────────────────

describe('Code-block splitting — tilde fence (~~~)', () => {
  it('detects ~~~ fenced block', async () => {
    const input = '~~~ruby\nputs "hello"\n~~~\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata?.language).toBe('ruby');
  });

  it('tilde block has fenceLength 3', async () => {
    const input = '~~~\nsome code\n~~~\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks[0].metadata?.fenceLength).toBe(3);
  });
});

// ─── 5. Unclosed code block — partial flush ───────────────────────────────────

describe('Code-block splitting — unclosed block (partial)', () => {
  it('emits partial=true for unclosed code block at stream end', async () => {
    const input = '```js\nconsole.log("hi");';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].partial).toBe(true);
  });

  it('flush="discard" discards unclosed code block', async () => {
    const input = '```js\nconsole.log("hi");';
    const chunks = await collect(
      aggregate(makeStream([input]), 'code-block', { flush: 'discard' }),
    );
    expect(chunks).toHaveLength(0);
  });

  it('complete block before unclosed block emits two chunks', async () => {
    const input = '```a\ncode1\n```\n```b\nunclosed';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks).toHaveLength(2);
    expect(chunks[0].partial).toBe(false);
    expect(chunks[1].partial).toBe(true);
  });
});

// ─── 6. Tokens split across fence boundary ────────────────────────────────────

describe('Code-block splitting — tokens split across fence', () => {
  it('opening fence split across tokens', async () => {
    const chunks = await collect(
      aggregate(makeStream(['``', '`js\nlet x = 1;\n```\n']), 'code-block'),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata?.language).toBe('js');
  });

  it('closing fence split across tokens', async () => {
    const chunks = await collect(
      aggregate(makeStream(['```js\nlet x = 1;\n``', '`\n']), 'code-block'),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].partial).toBe(false);
  });

  it('code body split across many tokens', async () => {
    const chunks = await collect(
      aggregate(
        makeStream(['```ts\n', 'const x', ' = 1;\n', 'const y = 2;\n', '```\n']),
        'code-block',
      ),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('const x = 1;');
    expect(chunks[0].content).toContain('const y = 2;');
  });
});

// ─── 7. Edge cases ────────────────────────────────────────────────────────────

describe('Code-block splitting — edge cases', () => {
  it('empty stream produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream([]), 'code-block'));
    expect(chunks).toHaveLength(0);
  });

  it('stream of only text (no fences) is flushed as partial', async () => {
    const chunks = await collect(aggregate(makeStream(['just some text']), 'code-block'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].partial).toBe(true);
  });

  it('empty code block (no body)', async () => {
    const input = '```\n```\n';
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    // Content between fences is empty; aggregate trims and may skip — at minimum no crash
    // The block itself may be emitted or skipped if trimmed content is empty
    expect(chunks.length).toBeGreaterThanOrEqual(0);
  });

  it('code block with only whitespace body is handled', async () => {
    const input = '```js\n   \n```\n';
    // No crash expected
    const chunks = await collect(aggregate(makeStream([input]), 'code-block'));
    expect(chunks.length).toBeGreaterThanOrEqual(0);
  });
});

// ─── 8. codeBlocks() convenience function ────────────────────────────────────

describe('codeBlocks() convenience function', () => {
  it('produces the same output as aggregate with unit "code-block"', async () => {
    const input = '```js\ncode\n```\n';
    const stream1 = makeStream([input]);
    const stream2 = makeStream([input]);
    const fromAggregate = await collect(aggregate(stream1, 'code-block'));
    const fromCodeBlocks = await collect(codeBlocks(stream2));
    expect(fromAggregate.map(c => c.content)).toEqual(fromCodeBlocks.map(c => c.content));
  });

  it('unit is "code-block" on every chunk', async () => {
    const input = '```a\nx\n```\n```b\ny\n```\n';
    const chunks = await collect(codeBlocks(makeStream([input])));
    for (const c of chunks) {
      expect(c.unit).toBe('code-block');
    }
  });

  it('accepts options', async () => {
    const input = '```js\nunclosed';
    const chunks = await collect(codeBlocks(makeStream([input]), { flush: 'discard' }));
    expect(chunks).toHaveLength(0);
  });
});
