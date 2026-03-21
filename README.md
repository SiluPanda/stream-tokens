# stream-tokens

Aggregate streaming LLM tokens into semantic units -- words, sentences, paragraphs, JSON objects, code blocks, and more.

LLM APIs stream text as small token fragments. `stream-tokens` buffers these fragments and emits complete semantic units, making it easy to build UIs that render word-by-word, sentence-by-sentence, or parse structured output like JSON as it arrives.

## Installation

```bash
npm install stream-tokens
```

## Quick Start

```typescript
import OpenAI from 'openai';
import { fromOpenAI, sentences } from 'stream-tokens';

const client = new OpenAI();
const stream = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Tell me a story.' }],
  stream: true,
});

for await (const chunk of sentences(fromOpenAI(stream))) {
  console.log(chunk.content);
  // "Once upon a time, there was a small village."
  // "The villagers were kind and hardworking."
  // ...
}
```

## API

### `aggregate(stream, unit, options?)`

The core function. Accepts an `AsyncIterable<string>` or `ReadableStream<string>` and yields `AggregatedChunk` objects.

```typescript
import { aggregate } from 'stream-tokens';

for await (const chunk of aggregate(tokenStream, 'word')) {
  console.log(chunk.content);  // complete word
  console.log(chunk.unit);     // 'word'
  console.log(chunk.index);    // 0, 1, 2, ...
  console.log(chunk.partial);  // false (true if flushed before boundary)
}
```

**Units:**

| Unit | Splits on |
|------|-----------|
| `'word'` | Whitespace (space, tab, newline) |
| `'sentence'` | Period, exclamation, question mark (with abbreviation/decimal awareness) |
| `'paragraph'` | Double newline |
| `'line'` | Single newline |
| `'json'` | Complete JSON objects/arrays (depth tracking) |
| `'code-block'` | Fenced code blocks (triple backtick) |
| `'markdown-section'` | Markdown headings |
| `'custom'` | User-provided `detect` function |

### Convenience Shorthands

Each unit has a shorthand that calls `aggregate()` with the unit preset:

```typescript
import { words, sentences, lines, paragraphs, jsonObjects } from 'stream-tokens';

for await (const chunk of words(tokenStream)) { /* ... */ }
for await (const chunk of sentences(tokenStream)) { /* ... */ }
for await (const chunk of lines(tokenStream)) { /* ... */ }
for await (const chunk of paragraphs(tokenStream)) { /* ... */ }
for await (const chunk of jsonObjects(tokenStream)) { /* ... */ }
```

### `detectWordBoundary(buffer, options)`

The low-level word boundary detector, exported for direct use or testing. Returns a `BoundaryResult` or `null`.

```typescript
import { detectWordBoundary } from 'stream-tokens';

const result = detectWordBoundary('hello world', {});
// { boundaryEnd: 5, nextStart: 6 }
```

## Adapters

Adapters convert provider-specific streaming formats into plain `AsyncIterable<string>` that `aggregate()` consumes.

### `fromOpenAI(stream)`

Extracts text from OpenAI chat completion streams. Structurally typed -- no OpenAI SDK import required.

```typescript
import { fromOpenAI, sentences } from 'stream-tokens';

const stream = await openai.chat.completions.create({ stream: true, /* ... */ });
for await (const chunk of sentences(fromOpenAI(stream))) {
  console.log(chunk.content);
}
```

### `fromAnthropic(stream)`

Extracts text from Anthropic message streams. Structurally typed -- no Anthropic SDK import required.

```typescript
import { fromAnthropic, words } from 'stream-tokens';

const stream = await anthropic.messages.create({ stream: true, /* ... */ });
for await (const chunk of words(fromAnthropic(stream))) {
  console.log(chunk.content);
}
```

## Options Reference

All options are passed via the `AggregatorOptions` object:

```typescript
interface AggregatorOptions {
  // General
  flush?: 'emit' | 'discard' | 'callback';  // What to do with remaining buffer on stream end (default: 'emit')
  onFlush?: (content: string, unit: AggregationUnit) => void;  // Called when flush='callback'
  maxBufferSize?: number;  // Force-emit if buffer exceeds this size (default: 10,000,000)

  // Word options
  trimWhitespace?: boolean;       // Trim whitespace from emitted content (default: true)
  includeWhitespace?: boolean;    // Include trailing whitespace in word content (default: false)
  preservePunctuation?: boolean;  // Keep punctuation attached to words (default: true)

  // Sentence options
  abbreviations?: string[];  // Extra abbreviations beyond built-in list

  // Paragraph options
  minParagraphLength?: number;  // Minimum character count (default: 1)

  // JSON options
  allowMultiple?: boolean;  // Emit multiple JSON values (default: true)

  // Code-block options
  includeDelimiters?: boolean;  // Include ``` lines in content (default: true)

  // Markdown-section options
  minLevel?: number;  // Minimum heading level to split on (default: 1)
  maxLevel?: number;  // Maximum heading level (default: 6)

  // Custom
  detect?: (buffer: string) => BoundaryResult | null;
}
```

### Flush modes

- **`'emit'`** (default): Emit remaining buffer as a final chunk with `partial: true` if it does not end at a natural boundary.
- **`'discard'`**: Silently discard remaining buffer.
- **`'callback'`**: Call `onFlush(content, unit)` with the remaining buffer.

## Types

### `AggregatedChunk`

```typescript
interface AggregatedChunk {
  content: string;           // The aggregated text
  unit: AggregationUnit;     // Which unit type produced this chunk
  index: number;             // Zero-based, increments per chunk
  partial: boolean;          // True if emitted before natural boundary
  metadata?: ChunkMetadata;  // Unit-specific metadata
}
```

### `BoundaryResult`

```typescript
interface BoundaryResult {
  boundaryEnd: number;      // Exclusive end index in the buffer
  nextStart: number;        // Start index for the next unit
  contentStart?: number;    // Optional start index of actual content
  metadata?: ChunkMetadata;
}
```

## License

MIT
