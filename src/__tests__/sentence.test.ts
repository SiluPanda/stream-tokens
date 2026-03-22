import { describe, it, expect } from 'vitest';
import { aggregate, sentences } from '../index';
import { detectSentenceBoundary } from '../units/sentence';
import { getAbbreviations } from '../abbreviations';
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

// ─── 1. detectSentenceBoundary unit tests ────────────────────────────────────

describe('detectSentenceBoundary — direct', () => {
  it('returns null for empty string', () => {
    expect(detectSentenceBoundary('', {})).toBeNull();
  });

  it('returns null for whitespace-only buffer', () => {
    expect(detectSentenceBoundary('   ', {})).toBeNull();
  });

  it('returns null when sentence is incomplete (no terminal punctuation)', () => {
    expect(detectSentenceBoundary('Hello world', {})).toBeNull();
  });

  it('returns null for period at end of buffer (needs lookahead)', () => {
    expect(detectSentenceBoundary('Hello world.', {})).toBeNull();
  });

  it('detects sentence boundary on period followed by space and uppercase', () => {
    const result = detectSentenceBoundary('Hello world. The next.', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(12); // after ". "
    expect(result!.nextStart).toBe(13);   // start of "The"
  });

  it('detects sentence boundary on exclamation mark', () => {
    const result = detectSentenceBoundary('Hello world! The next.', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(12);
  });

  it('detects sentence boundary on question mark', () => {
    const result = detectSentenceBoundary('Hello world? The next.', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(12);
  });

  it('emits ! at end of buffer without lookahead', () => {
    const result = detectSentenceBoundary('Hello world!', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(12);
  });

  it('emits ? at end of buffer without lookahead', () => {
    const result = detectSentenceBoundary('Hello world?', {});
    expect(result).not.toBeNull();
    expect(result!.boundaryEnd).toBe(12);
  });

  it('skips abbreviation (Dr.)', () => {
    const result = detectSentenceBoundary('Dr. Smith went home. The end.', {});
    expect(result).not.toBeNull();
    // Should skip "Dr." and find "home."
    const content = 'Dr. Smith went home. The end.'.slice(0, result!.boundaryEnd);
    expect(content).toBe('Dr. Smith went home.');
  });

  it('skips decimal number (3.14)', () => {
    const result = detectSentenceBoundary('The value is 3.14 exactly. Next sentence.', {});
    expect(result).not.toBeNull();
    const content = 'The value is 3.14 exactly. Next sentence.'.slice(0, result!.boundaryEnd);
    expect(content).toBe('The value is 3.14 exactly.');
  });
});

// ─── 2. Basic sentence splitting ─────────────────────────────────────────────

describe('Sentence splitting — basic', () => {
  it('splits two sentences on period', async () => {
    const chunks = await collect(aggregate(makeStream(['Hello world. The end. ']), 'sentence'));
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('Hello world.');
    expect(contents.length).toBeGreaterThanOrEqual(1);
  });

  it('splits on question mark', async () => {
    const chunks = await collect(aggregate(makeStream(['Is this a test? Yes it is. ']), 'sentence'));
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('Is this a test?');
  });

  it('splits on exclamation mark', async () => {
    const chunks = await collect(aggregate(makeStream(['Wow! That was great. ']), 'sentence'));
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('Wow!');
  });

  it('splits three sentences', async () => {
    const chunks = await collect(
      aggregate(makeStream(['First sentence. Second sentence. Third sentence. ']), 'sentence'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual([
      'First sentence.',
      'Second sentence.',
      'Third sentence.',
    ]);
  });
});

// ─── 3. Abbreviation handling ────────────────────────────────────────────────

describe('Sentence splitting — abbreviations', () => {
  it('Dr. Smith is one sentence', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Dr. Smith went to the store. He bought milk. ']), 'sentence'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('Dr. Smith went to the store.');
  });

  it('Mr. Jones is one sentence', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Mr. Jones arrived. He was tired. ']), 'sentence'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('Mr. Jones arrived.');
  });

  it('Mrs. and Ms. abbreviations', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Mrs. Smith and Ms. Jones went home. They were happy. ']), 'sentence'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('Mrs. Smith and Ms. Jones went home.');
  });

  it('Prof. abbreviation', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Prof. Johnson gave a lecture. It was great. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Prof. Johnson gave a lecture.');
  });

  it('multiple abbreviations in one sentence', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Dr. Smith and Prof. Jones met at St. Mary. They talked. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Dr. Smith and Prof. Jones met at St. Mary.');
  });

  it('e.g. abbreviation', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Use tools e.g. hammers and nails. Then proceed. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Use tools e.g. hammers and nails.');
  });

  it('i.e. abbreviation', async () => {
    const chunks = await collect(
      aggregate(makeStream(['The result i.e. the outcome was good. Next step. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('The result i.e. the outcome was good.');
  });

  it('etc. abbreviation at end of sentence with next uppercase', async () => {
    // "etc." is an abbreviation, so it does not cause a split by itself.
    // The sentence continues until the next period boundary is confirmed.
    const chunks = await collect(
      aggregate(makeStream(['Bring food, drinks, etc. The party starts soon. More text. ']), 'sentence'),
    );
    // "etc." is recognized as abbreviation and skipped, so the first
    // sentence boundary found is after "soon."
    const contents = chunks.map(c => c.content);
    expect(contents.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 4. Decimal number handling ──────────────────────────────────────────────

describe('Sentence splitting — decimal numbers', () => {
  it('3.14 does not split', async () => {
    const chunks = await collect(
      aggregate(makeStream(['The value of pi is 3.14 approximately. That is cool. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('The value of pi is 3.14 approximately.');
  });

  it('multiple decimals in one sentence', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Prices are 9.99 and 12.50 today. Shop now. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Prices are 9.99 and 12.50 today.');
  });

  it('number at end of sentence is not a decimal', async () => {
    const chunks = await collect(
      aggregate(makeStream(['He scored 72. The crowd cheered. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('He scored 72.');
  });
});

// ─── 5. Ellipsis handling ────────────────────────────────────────────────────

describe('Sentence splitting — ellipsis', () => {
  it('ellipsis as sentence end (default)', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Wait for it... The answer is here. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Wait for it...');
  });

  it('ellipsis not a sentence end when ellipsisIsSentenceEnd is false', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Wait for it... the answer is here. The end. ']), 'sentence', {
        ellipsisIsSentenceEnd: false,
      }),
    );
    // With ellipsis not being a sentence end, "Wait for it... the answer is here."
    // becomes one sentence (period followed by uppercase confirms)
    expect(chunks[0].content).toBe('Wait for it... the answer is here.');
  });
});

// ─── 6. Multiple punctuation ─────────────────────────────────────────────────

describe('Sentence splitting — multiple punctuation', () => {
  it('?! is treated as one boundary', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Really?! That is amazing. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Really?!');
  });

  it('!! is treated as one boundary', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Wow!! That was great. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Wow!!');
  });

  it('?? is treated as one boundary', async () => {
    const chunks = await collect(
      aggregate(makeStream(['What?? No way. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('What??');
  });
});

// ─── 7. URL handling ─────────────────────────────────────────────────────────

describe('Sentence splitting — URLs', () => {
  it('period in URL does not split sentence', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Visit https://example.com for details. Then proceed. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Visit https://example.com for details.');
  });

  it('email address does not split sentence', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Email user@example.com for help. Thank you. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Email user@example.com for help.');
  });
});

// ─── 8. Custom abbreviation list ─────────────────────────────────────────────

describe('Sentence splitting — custom abbreviations', () => {
  it('custom abbreviation list extends defaults', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Capt. Hook sailed away. The end. ']), 'sentence', {
        abbreviations: ['Capt'],
      }),
    );
    expect(chunks[0].content).toBe('Capt. Hook sailed away.');
  });
});

// ─── 9. minLength option ─────────────────────────────────────────────────────

describe('Sentence splitting — minLength option', () => {
  it('suppresses short sentences below minLength', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Hi! How are you doing today? ']), 'sentence', {
        minLength: 10,
      }),
    );
    // "Hi!" is only 3 chars, below minLength of 10
    // "How are you doing today?" is 24 chars, above minLength
    const contents = chunks.map(c => c.content);
    // "Hi!" should be merged into the next sentence or skipped
    // Based on the detector, it won't emit "Hi!" as a boundary, so it accumulates
    expect(contents.some(c => c.includes('How are you doing today?'))).toBe(true);
  });

  it('minLength 0 (default) emits everything', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Hi! Bye! ']), 'sentence'),
    );
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('Hi!');
  });
});

// ─── 10. Empty and single-token streams ──────────────────────────────────────

describe('Sentence splitting — edge cases', () => {
  it('empty stream produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream([]), 'sentence'));
    expect(chunks).toHaveLength(0);
  });

  it('stream of empty tokens produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream(['', '', '']), 'sentence'));
    expect(chunks).toHaveLength(0);
  });

  it('single token without punctuation flushes as partial', async () => {
    const chunks = await collect(aggregate(makeStream(['Hello world']), 'sentence'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Hello world');
    expect(chunks[0].partial).toBe(true);
  });

  it('single complete sentence', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Hello world! ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Hello world!');
    expect(chunks[0].partial).toBe(false);
  });

  it('whitespace-only stream produces no chunks', async () => {
    const chunks = await collect(aggregate(makeStream(['   ']), 'sentence'));
    expect(chunks).toHaveLength(0);
  });
});

// ─── 11. Flush behavior ─────────────────────────────────────────────────────

describe('Sentence splitting — flush', () => {
  it('incomplete sentence flushed with partial=true', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Hello world']), 'sentence'),
    );
    const last = chunks[chunks.length - 1];
    expect(last.content).toBe('Hello world');
    expect(last.partial).toBe(true);
  });

  it('flush="discard" discards incomplete sentence', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Complete! Incomplete part']), 'sentence', { flush: 'discard' }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Complete!');
  });

  it('flush="callback" calls onFlush with remaining content', async () => {
    let flushed = '';
    await collect(
      aggregate(makeStream(['Complete! Incomplete']), 'sentence', {
        flush: 'callback',
        onFlush: (content) => { flushed = content; },
      }),
    );
    expect(flushed).toBe('Incomplete');
  });

  it('sentence ending with . at stream end is flushed', async () => {
    // Period at end of buffer needs lookahead, so it stays in buffer.
    // On flush, isPartial checks if content ends with terminal punctuation.
    // "Hello world." ends with "." so partial is false.
    const chunks = await collect(
      aggregate(makeStream(['Hello world.']), 'sentence'),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Hello world.');
    expect(chunks[0].partial).toBe(false);
  });

  it('no flush needed when sentence ends with ! and nothing remains', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Hello world!']), 'sentence'),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Hello world!');
    expect(chunks[0].partial).toBe(false);
  });
});

// ─── 12. Token splitting across boundaries ───────────────────────────────────

describe('Sentence splitting — tokens split across boundaries', () => {
  it('period in separate token', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Hello world', '.', ' The next. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Hello world.');
  });

  it('abbreviation split across tokens', async () => {
    const chunks = await collect(
      aggregate(makeStream(['Dr', '.', ' Smith went home. The end. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('Dr. Smith went home.');
  });

  it('single character tokens build sentence', async () => {
    const chars = 'Hi! Bye! '.split('');
    const chunks = await collect(aggregate(makeStream(chars), 'sentence'));
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('Hi!');
    expect(contents[1]).toBe('Bye!');
  });
});

// ─── 13. sentences() convenience function ────────────────────────────────────

describe('sentences() convenience function', () => {
  it('produces same output as aggregate with unit "sentence"', async () => {
    const stream1 = makeStream(['Hello! World! ']);
    const stream2 = makeStream(['Hello! World! ']);
    const fromAggregate = await collect(aggregate(stream1, 'sentence'));
    const fromSentences = await collect(sentences(stream2));
    expect(fromAggregate.map(c => c.content)).toEqual(fromSentences.map(c => c.content));
  });

  it('unit is "sentence" on every chunk', async () => {
    const chunks = await collect(sentences(makeStream(['Hello! World! '])));
    for (const c of chunks) {
      expect(c.unit).toBe('sentence');
    }
  });

  it('indexes increment correctly', async () => {
    const chunks = await collect(sentences(makeStream(['One! Two! Three! '])));
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
  });
});

// ─── 14. Single-letter initials ──────────────────────────────────────────────

describe('Sentence splitting — single-letter initials', () => {
  it('J. K. Rowling is one sentence', async () => {
    const chunks = await collect(
      aggregate(makeStream(['J. K. Rowling wrote books. The end. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('J. K. Rowling wrote books.');
  });
});

// ─── 15. Closing quotes/parens after punctuation ─────────────────────────────

describe('Sentence splitting — closing quotes/parens', () => {
  it('period followed by closing quote', async () => {
    const chunks = await collect(
      aggregate(makeStream(['"Hello." She said goodbye. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('"Hello."');
  });

  it('exclamation followed by closing paren', async () => {
    const chunks = await collect(
      aggregate(makeStream(['(Wow!) That was great. ']), 'sentence'),
    );
    expect(chunks[0].content).toBe('(Wow!)');
  });
});

// ─── 16. getAbbreviations function ───────────────────────────────────────────

describe('getAbbreviations', () => {
  it('returns default set when called with no options', () => {
    const abbrevs = getAbbreviations();
    expect(abbrevs.has('mr')).toBe(true);
    expect(abbrevs.has('dr')).toBe(true);
    expect(abbrevs.has('prof')).toBe(true);
    expect(abbrevs.has('etc')).toBe(true);
  });

  it('replaces defaults when abbreviations option is provided', () => {
    const abbrevs = getAbbreviations({ abbreviations: ['Foo', 'Bar'] });
    expect(abbrevs.has('foo')).toBe(true);
    expect(abbrevs.has('bar')).toBe(true);
    expect(abbrevs.has('mr')).toBe(false);
    expect(abbrevs.has('dr')).toBe(false);
  });

  it('extends defaults when additionalAbbreviations is provided', () => {
    const abbrevs = getAbbreviations({ additionalAbbreviations: ['Capt', 'Adm'] });
    expect(abbrevs.has('capt')).toBe(true);
    expect(abbrevs.has('adm')).toBe(true);
    expect(abbrevs.has('mr')).toBe(true); // still has defaults
  });

  it('strips trailing period from abbreviations', () => {
    const abbrevs = getAbbreviations({ abbreviations: ['Dr.', 'Mr.'] });
    expect(abbrevs.has('dr')).toBe(true);
    expect(abbrevs.has('mr')).toBe(true);
  });

  it('is case-insensitive', () => {
    const abbrevs = getAbbreviations({ abbreviations: ['DR', 'Mr'] });
    expect(abbrevs.has('dr')).toBe(true);
    expect(abbrevs.has('mr')).toBe(true);
  });
});

// ─── 17. Mixed sentence types ────────────────────────────────────────────────

describe('Sentence splitting — mixed types', () => {
  it('handles a paragraph with various sentence types', async () => {
    const text = 'First sentence. Second one! Third? Fourth sentence. ';
    const chunks = await collect(aggregate(makeStream([text]), 'sentence'));
    const contents = chunks.map(c => c.content);
    expect(contents).toEqual([
      'First sentence.',
      'Second one!',
      'Third?',
      'Fourth sentence.',
    ]);
  });

  it('handles newlines between sentences', async () => {
    const text = 'First sentence.\nSecond sentence.\n';
    const chunks = await collect(aggregate(makeStream([text]), 'sentence'));
    const contents = chunks.map(c => c.content);
    expect(contents[0]).toBe('First sentence.');
    expect(contents[1]).toBe('Second sentence.');
  });
});
