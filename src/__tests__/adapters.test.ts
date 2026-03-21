import { describe, it, expect } from 'vitest';
import { fromOpenAI } from '../adapters/openai';
import { fromAnthropic } from '../adapters/anthropic';
import { sentences, words } from '../index';
import type { AggregatedChunk } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Collect all strings from an async iterable of strings. */
async function collectStrings(it: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = [];
  for await (const s of it) {
    result.push(s);
  }
  return result;
}

/** Collect all AggregatedChunks from an async iterable. */
async function collectChunks(it: AsyncIterable<AggregatedChunk>): Promise<AggregatedChunk[]> {
  const result: AggregatedChunk[] = [];
  for await (const chunk of it) {
    result.push(chunk);
  }
  return result;
}

/** Create an async iterable from an array of typed event objects. */
async function* makeEventStream<T>(events: T[]): AsyncIterable<T> {
  for (const ev of events) {
    yield ev;
  }
}

// ─── OpenAI adapter types ────────────────────────────────────────────────────

type OpenAIChunk = { choices: Array<{ delta: { content?: string | null } }> };

// ─── Anthropic adapter types ──────────────────────────────────────────────────

type AnthropicEvent = { type: string; delta?: { type?: string; text?: string } };

// ─── 1. OpenAI adapter — basic extraction ────────────────────────────────────

describe('fromOpenAI — basic extraction', () => {
  it('yields text from each choices[0].delta.content', async () => {
    const events: OpenAIChunk[] = [
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' world' } }] },
      { choices: [{ delta: { content: '!' } }] },
    ];
    const texts = await collectStrings(fromOpenAI(makeEventStream(events)));
    expect(texts).toEqual(['Hello', ' world', '!']);
  });

  it('concatenated output matches original text', async () => {
    const events: OpenAIChunk[] = [
      { choices: [{ delta: { content: 'Streaming ' } }] },
      { choices: [{ delta: { content: 'is ' } }] },
      { choices: [{ delta: { content: 'great.' } }] },
    ];
    const texts = await collectStrings(fromOpenAI(makeEventStream(events)));
    expect(texts.join('')).toBe('Streaming is great.');
  });
});

// ─── 2. OpenAI adapter — null content skipped ────────────────────────────────

describe('fromOpenAI — null content skipped', () => {
  it('skips chunks where content is null', async () => {
    const events: OpenAIChunk[] = [
      { choices: [{ delta: { content: null } }] },
      { choices: [{ delta: { content: 'hello' } }] },
      { choices: [{ delta: { content: null } }] },
    ];
    const texts = await collectStrings(fromOpenAI(makeEventStream(events)));
    expect(texts).toEqual(['hello']);
  });

  it('skips chunks where content is undefined', async () => {
    const events: OpenAIChunk[] = [
      { choices: [{ delta: {} }] },
      { choices: [{ delta: { content: 'world' } }] },
    ];
    const texts = await collectStrings(fromOpenAI(makeEventStream(events)));
    expect(texts).toEqual(['world']);
  });

  it('skips chunks where content is empty string', async () => {
    const events: OpenAIChunk[] = [
      { choices: [{ delta: { content: '' } }] },
      { choices: [{ delta: { content: 'text' } }] },
      { choices: [{ delta: { content: '' } }] },
    ];
    const texts = await collectStrings(fromOpenAI(makeEventStream(events)));
    expect(texts).toEqual(['text']);
  });

  it('yields nothing for a stream of all-null content', async () => {
    const events: OpenAIChunk[] = [
      { choices: [{ delta: { content: null } }] },
      { choices: [{ delta: { content: null } }] },
    ];
    const texts = await collectStrings(fromOpenAI(makeEventStream(events)));
    expect(texts).toHaveLength(0);
  });
});

// ─── 3. OpenAI adapter — empty / missing choices ─────────────────────────────

describe('fromOpenAI — empty or missing choices', () => {
  it('skips chunks with empty choices array', async () => {
    const events: OpenAIChunk[] = [
      { choices: [] },
      { choices: [{ delta: { content: 'hi' } }] },
    ];
    const texts = await collectStrings(fromOpenAI(makeEventStream(events)));
    expect(texts).toEqual(['hi']);
  });

  it('yields nothing for empty stream', async () => {
    const texts = await collectStrings(fromOpenAI(makeEventStream<OpenAIChunk>([])));
    expect(texts).toHaveLength(0);
  });
});

// ─── 4. OpenAI adapter — metadata / role events skipped ──────────────────────

describe('fromOpenAI — metadata events skipped', () => {
  it('skips role-only deltas (no content field)', async () => {
    // Role events have delta.content = undefined
    const events = [
      { choices: [{ delta: { role: 'assistant' } as { content?: string | null; role?: string } }] },
      { choices: [{ delta: { content: 'response' } }] },
    ] as OpenAIChunk[];
    const texts = await collectStrings(fromOpenAI(makeEventStream(events)));
    expect(texts).toEqual(['response']);
  });

  it('skips finish_reason chunks that have null content', async () => {
    const events: OpenAIChunk[] = [
      { choices: [{ delta: { content: 'done' } }] },
      { choices: [{ delta: { content: null } }] }, // finish event
    ];
    const texts = await collectStrings(fromOpenAI(makeEventStream(events)));
    expect(texts).toEqual(['done']);
  });
});

// ─── 5. Anthropic adapter — basic extraction ─────────────────────────────────

describe('fromAnthropic — basic extraction', () => {
  it('yields text from content_block_delta text_delta events', async () => {
    const events: AnthropicEvent[] = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
    ];
    const texts = await collectStrings(fromAnthropic(makeEventStream(events)));
    expect(texts).toEqual(['Hello', ' world']);
  });

  it('concatenated output matches original text', async () => {
    const events: AnthropicEvent[] = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'The ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'is 42.' } },
    ];
    const texts = await collectStrings(fromAnthropic(makeEventStream(events)));
    expect(texts.join('')).toBe('The answer is 42.');
  });
});

// ─── 6. Anthropic adapter — non-text events skipped ──────────────────────────

describe('fromAnthropic — non-text events skipped', () => {
  it('skips message_start events', async () => {
    const events: AnthropicEvent[] = [
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
    ];
    const texts = await collectStrings(fromAnthropic(makeEventStream(events)));
    expect(texts).toEqual(['hi']);
  });

  it('skips content_block_start events', async () => {
    const events: AnthropicEvent[] = [
      { type: 'content_block_start' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'text' } },
    ];
    const texts = await collectStrings(fromAnthropic(makeEventStream(events)));
    expect(texts).toEqual(['text']);
  });

  it('skips content_block_stop events', async () => {
    const events: AnthropicEvent[] = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'end' } },
      { type: 'content_block_stop' },
    ];
    const texts = await collectStrings(fromAnthropic(makeEventStream(events)));
    expect(texts).toEqual(['end']);
  });

  it('skips message_delta events', async () => {
    const events: AnthropicEvent[] = [
      { type: 'message_delta', delta: { type: 'text_delta', text: 'should not yield' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'yes' } },
    ];
    const texts = await collectStrings(fromAnthropic(makeEventStream(events)));
    expect(texts).toEqual(['yes']);
  });

  it('skips message_stop events', async () => {
    const events: AnthropicEvent[] = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'last' } },
      { type: 'message_stop' },
    ];
    const texts = await collectStrings(fromAnthropic(makeEventStream(events)));
    expect(texts).toEqual(['last']);
  });

  it('skips content_block_delta with non-text delta type', async () => {
    const events: AnthropicEvent[] = [
      { type: 'content_block_delta', delta: { type: 'input_json_delta', text: '{"key":' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'actual text' } },
    ];
    const texts = await collectStrings(fromAnthropic(makeEventStream(events)));
    expect(texts).toEqual(['actual text']);
  });

  it('skips content_block_delta with falsy text', async () => {
    const events: AnthropicEvent[] = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'real' } },
    ];
    const texts = await collectStrings(fromAnthropic(makeEventStream(events)));
    expect(texts).toEqual(['real']);
  });

  it('yields nothing for a stream of only lifecycle events', async () => {
    const events: AnthropicEvent[] = [
      { type: 'message_start' },
      { type: 'content_block_start' },
      { type: 'content_block_stop' },
      { type: 'message_delta' },
      { type: 'message_stop' },
    ];
    const texts = await collectStrings(fromAnthropic(makeEventStream(events)));
    expect(texts).toHaveLength(0);
  });

  it('yields nothing for an empty stream', async () => {
    const texts = await collectStrings(fromAnthropic(makeEventStream<AnthropicEvent>([])));
    expect(texts).toHaveLength(0);
  });
});

// ─── 7. Integration: fromOpenAI → sentences() ────────────────────────────────

describe('Integration: fromOpenAI → sentences()', () => {
  it('extracts sentences from a mock OpenAI stream', async () => {
    const events: OpenAIChunk[] = [
      { choices: [{ delta: { content: 'Hello world.' } }] },
      { choices: [{ delta: { content: null } }] }, // role event
      { choices: [{ delta: { content: ' How are you?' } }] },
      { choices: [{ delta: { content: ' I am fine.' } }] },
    ];
    const textStream = fromOpenAI(makeEventStream(events));
    const chunks = await collectChunks(sentences(textStream));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const joined = chunks.map(c => c.content).join(' ');
    expect(joined).toContain('Hello world.');
    expect(joined).toContain('How are you?');
    for (const chunk of chunks) {
      expect(chunk.unit).toBe('sentence');
    }
  });

  it('handles a stream where each token is a single word', async () => {
    const words_list = ['The ', 'cat ', 'sat. ', 'A ', 'dog ', 'ran.'];
    const events: OpenAIChunk[] = words_list.map(w => ({
      choices: [{ delta: { content: w } }],
    }));
    const textStream = fromOpenAI(makeEventStream(events));
    const chunks = await collectChunks(sentences(textStream));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].content).toContain('cat sat.');
  });
});

// ─── 8. Integration: fromAnthropic → words() ─────────────────────────────────

describe('Integration: fromAnthropic → words()', () => {
  it('extracts words from a mock Anthropic stream', async () => {
    const events: AnthropicEvent[] = [
      { type: 'message_start' },
      { type: 'content_block_start' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'foo' } },
      { type: 'content_block_stop' },
      { type: 'message_stop' },
    ];
    const textStream = fromAnthropic(makeEventStream(events));
    const chunks = await collectChunks(words(textStream));
    const contents = chunks.map(c => c.content);
    expect(contents).toContain('hello');
    expect(contents).toContain('world');
    expect(contents).toContain('foo');
    for (const chunk of chunks) {
      expect(chunk.unit).toBe('word');
    }
  });

  it('indexes increment correctly across mixed event types', async () => {
    const events: AnthropicEvent[] = [
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'one ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'two ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'three' } },
      { type: 'message_stop' },
    ];
    const textStream = fromAnthropic(makeEventStream(events));
    const chunks = await collectChunks(words(textStream));
    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
  });
});
