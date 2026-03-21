import { describe, it, expect } from 'vitest';
import { aggregate, markdownSections } from '../index';
import { detectMarkdownSectionBoundary } from '../units/markdown-section';
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

// ─── 1. detectMarkdownSectionBoundary unit tests ─────────────────────────────

describe('detectMarkdownSectionBoundary — direct', () => {
  it('returns null for empty string', () => {
    expect(detectMarkdownSectionBoundary('', {})).toBeNull();
  });

  it('returns null for text with no headings', () => {
    expect(detectMarkdownSectionBoundary('just some text\nmore text\n', {})).toBeNull();
  });

  it('returns null for single heading with content but no second heading', () => {
    expect(detectMarkdownSectionBoundary('# Title\nsome content', {})).toBeNull();
  });

  it('returns a boundary when a second heading is found', () => {
    const buffer = '# Section 1\ncontent here\n# Section 2\nmore content';
    const result = detectMarkdownSectionBoundary(buffer, {});
    expect(result).not.toBeNull();
    // boundaryEnd should be the start of the second heading line
    const secondHeadingIdx = buffer.indexOf('# Section 2');
    expect(result!.boundaryEnd).toBe(secondHeadingIdx);
    expect(result!.nextStart).toBe(secondHeadingIdx);
  });

  it('metadata has correct level and heading for the first section', () => {
    const buffer = '## Introduction\nsome text\n## Methods\nmore text';
    const result = detectMarkdownSectionBoundary(buffer, {});
    expect(result).not.toBeNull();
    expect(result!.metadata?.level).toBe(2);
    expect(result!.metadata?.heading).toBe('Introduction');
  });

  it('emits pre-heading content as level 0 section', () => {
    const buffer = 'preamble text\n# First Heading\ncontent';
    const result = detectMarkdownSectionBoundary(buffer, {});
    expect(result).not.toBeNull();
    expect(result!.metadata?.level).toBe(0);
    // boundaryEnd is the start of the heading
    expect(result!.boundaryEnd).toBe(buffer.indexOf('# First Heading'));
  });

  it('handles h3 headings', () => {
    const buffer = '### Part A\ntext\n### Part B\ntext';
    const result = detectMarkdownSectionBoundary(buffer, {});
    expect(result).not.toBeNull();
    expect(result!.metadata?.level).toBe(3);
    expect(result!.metadata?.heading).toBe('Part A');
  });

  it('minLevel option: ignores headings below minLevel', () => {
    // minLevel=2 means # headings are ignored as split points.
    // The text before the first visible heading (## Section) is treated as
    // pre-heading content and emitted as a level-0 section.
    const buffer = '# Ignored\ncontent\n## Section\ntext';
    const result = detectMarkdownSectionBoundary(buffer, { minLevel: 2 });
    expect(result).not.toBeNull();
    // Pre-heading content (including the ignored # line) is emitted as level 0
    expect(result!.metadata?.level).toBe(0);
    // boundaryEnd is at the start of ## Section
    expect(result!.boundaryEnd).toBe(buffer.indexOf('## Section'));
  });

  it('maxLevel option: ignores headings above maxLevel', () => {
    // maxLevel=2 means ### and below are ignored
    const buffer = '# Title\ncontent\n## Sub\nmore\n### Ignored\ntext';
    const result = detectMarkdownSectionBoundary(buffer, { maxLevel: 2 });
    expect(result).not.toBeNull();
    // Should split at ## Sub (which is the second visible heading)
    expect(result!.metadata?.level).toBe(1);
    expect(result!.metadata?.heading).toBe('Title');
  });
});

// ─── 2. Basic section splitting ──────────────────────────────────────────────

describe('Markdown-section splitting — basic', () => {
  it('emits section 1 when section 2 begins', async () => {
    const input = '# Section 1\nContent of section 1.\n# Section 2\nContent of section 2.';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    // At least the first section should be emitted; last is flushed
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].content).toContain('Section 1');
    expect(chunks[0].content).toContain('Content of section 1.');
  });

  it('section chunk has unit "markdown-section"', async () => {
    const input = '# A\ntext\n# B\ntext';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    for (const c of chunks) {
      expect(c.unit).toBe('markdown-section');
    }
  });

  it('section chunk has metadata.level', async () => {
    const input = '## Alpha\ntext\n## Beta\ntext';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    expect(chunks[0].metadata?.level).toBe(2);
  });

  it('section chunk has metadata.heading', async () => {
    const input = '# Hello World\ntext\n# Goodbye World\ntext';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    expect(chunks[0].metadata?.heading).toBe('Hello World');
  });

  it('last section is flushed with partial=true when no trailing heading', async () => {
    const input = '# Section 1\ncontent\n# Section 2\ncontent';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    const last = chunks[chunks.length - 1];
    expect(last.partial).toBe(true);
  });

  it('indexes increment correctly across sections', async () => {
    const input = '# A\ntext\n# B\ntext\n# C\ntext';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });
});

// ─── 3. Multiple heading levels ──────────────────────────────────────────────

describe('Markdown-section splitting — multiple heading levels', () => {
  it('splits on any heading level by default', async () => {
    const input = '# H1\ntext\n## H2\ntext\n### H3\ntext';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('minLevel=2 treats level-1 heading as pre-heading content', async () => {
    // Only ## and deeper are split points.
    // The entire text before ## Sub (including # Top and its content) is
    // treated as pre-heading preamble and emitted as a level-0 section.
    const input = '# Top\nsome intro text\n## Sub\ndetails';
    const chunks = await collect(
      aggregate(makeStream([input]), 'markdown-section', { minLevel: 2 }),
    );
    // chunk 0: pre-heading preamble (level 0) — "# Top\nsome intro text"
    // chunk 1: ## Sub section flushed as partial
    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata?.level).toBe(0);
    expect(chunks[1].partial).toBe(true);
  });

  it('maxLevel=1 only splits on h1', async () => {
    const input = '# H1\ntext\n## H2\ntext\n# Another H1\ntext';
    const chunks = await collect(
      aggregate(makeStream([input]), 'markdown-section', { maxLevel: 1 }),
    );
    // ## H2 is ignored; split happens at # Another H1
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].metadata?.level).toBe(1);
  });
});

// ─── 4. Pre-heading content (preamble) ───────────────────────────────────────

describe('Markdown-section splitting — pre-heading preamble', () => {
  it('pre-heading content is emitted as a section with level 0', async () => {
    const input = 'Intro paragraph.\n\n# First Section\ncontent';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    // First chunk should be the preamble
    expect(chunks[0].metadata?.level).toBe(0);
    expect(chunks[0].content).toContain('Intro paragraph.');
  });

  it('preamble followed by two sections: all three chunks emitted with correct token ordering', async () => {
    // Preamble must arrive before any heading token for it to be emitted separately.
    // Token ordering: preamble → section1 heading+body → section2 heading+body
    const chunks = await collect(
      aggregate(
        makeStream(['Preamble\n', '# Section 1\n', 'text\n', '# Section 2\ntext']),
        'markdown-section',
      ),
    );
    // chunk 0: preamble (level 0)
    // chunk 1: Section 1 heading + text content
    // chunk 2: Section 2 flushed as partial
    expect(chunks).toHaveLength(3);
    expect(chunks[0].metadata?.level).toBe(0);
    expect(chunks[1].metadata?.level).toBe(1);
    expect(chunks[1].metadata?.heading).toBe('Section 1');
    expect(chunks[2].partial).toBe(true);
  });
});

// ─── 5. Tokens split across heading boundary ─────────────────────────────────

describe('Markdown-section splitting — tokens split across heading', () => {
  it('heading split across tokens', async () => {
    const chunks = await collect(
      aggregate(makeStream(['# Section 1\ntext\n#', ' Section 2\ntext']), 'markdown-section'),
    );
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toContain('Section 1');
  });

  it('content split across many tokens', async () => {
    const chunks = await collect(
      aggregate(
        makeStream(['# S1\n', 'line1\n', 'line2\n', '# S2\n', 'line3\n']),
        'markdown-section',
      ),
    );
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toContain('S1');
    expect(chunks[0].content).toContain('line1');
    expect(chunks[0].content).toContain('line2');
  });
});

// ─── 6. Flush behavior ────────────────────────────────────────────────────────

describe('Markdown-section splitting — flush behavior', () => {
  it('flush="discard" discards last incomplete section', async () => {
    const input = '# Section 1\ncontent\n# Section 2\ncontent without end';
    const chunks = await collect(
      aggregate(makeStream([input]), 'markdown-section', { flush: 'discard' }),
    );
    // Section 1 is complete; Section 2 is discarded
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('Section 1');
  });

  it('flush="emit" (default) emits last section as partial', async () => {
    const input = '# Section 1\ncontent\n# Section 2\ncontent';
    const chunks = await collect(
      aggregate(makeStream([input]), 'markdown-section', { flush: 'emit' }),
    );
    const last = chunks[chunks.length - 1];
    expect(last.partial).toBe(true);
  });
});

// ─── 7. Edge cases ────────────────────────────────────────────────────────────

describe('Markdown-section splitting — edge cases', () => {
  it('empty stream produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream([]), 'markdown-section'));
    expect(chunks).toHaveLength(0);
  });

  it('stream with no headings is flushed as a single partial chunk', async () => {
    const input = 'This is just text with no headings.\nAnother line.';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].partial).toBe(true);
  });

  it('single heading with no content is flushed', async () => {
    const input = '# Only Heading\n';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].partial).toBe(true);
  });

  it('multiple consecutive headings with no body content between them', async () => {
    const input = '# A\n# B\n# C\n';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    // Each heading ends the previous section; sections may be empty (trimmed/skipped)
    // At minimum, no crash
    expect(chunks.length).toBeGreaterThanOrEqual(0);
  });

  it('heading with only whitespace body is handled', async () => {
    const input = '# Title\n   \n# Next\ntext';
    const chunks = await collect(aggregate(makeStream([input]), 'markdown-section'));
    // No crash; at least the visible section with text should appear
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 8. markdownSections() convenience function ──────────────────────────────

describe('markdownSections() convenience function', () => {
  it('produces the same output as aggregate with unit "markdown-section"', async () => {
    const input = '# A\ntext\n# B\ntext';
    const stream1 = makeStream([input]);
    const stream2 = makeStream([input]);
    const fromAggregate = await collect(aggregate(stream1, 'markdown-section'));
    const fromMarkdownSections = await collect(markdownSections(stream2));
    expect(fromAggregate.map(c => c.content)).toEqual(fromMarkdownSections.map(c => c.content));
  });

  it('unit is "markdown-section" on every chunk', async () => {
    const input = '# A\ntext\n# B\ntext';
    const chunks = await collect(markdownSections(makeStream([input])));
    for (const c of chunks) {
      expect(c.unit).toBe('markdown-section');
    }
  });

  it('accepts options', async () => {
    const input = '# A\ntext\n# B\ntext\n# C\ntext';
    const chunks = await collect(
      markdownSections(makeStream([input]), { flush: 'discard' }),
    );
    // Last section (C) is discarded; A and B are emitted
    expect(chunks).toHaveLength(2);
  });
});
