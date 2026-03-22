# stream-tokens

Aggregate streaming LLM tokens into semantic units -- words, sentences, paragraphs, JSON objects, code blocks, and more.

[![npm version](https://img.shields.io/npm/v/stream-tokens.svg)](https://www.npmjs.com/package/stream-tokens)
[![license](https://img.shields.io/npm/l/stream-tokens.svg)](https://github.com/SiluPanda/stream-tokens/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/stream-tokens.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

---

## Description

LLM APIs stream text as small token fragments. A response like "The capital of France is Paris." may arrive as nine separate events: `"The"`, `" cap"`, `"ital"`, `" of"`, `" France"`, `" is"`, `" Par"`, `"is"`, `"."`. These raw fragments are unusable for downstream processing that requires semantic boundaries. A text-to-speech engine needs complete sentences. A streaming UI needs complete words. A JSON consumer needs complete objects.

`stream-tokens` sits between the LLM stream and the consumer, buffering raw token fragments and emitting complete semantic units as they form. It accepts any `AsyncIterable<string>` or `ReadableStream<string>` and returns an `AsyncIterable<AggregatedChunk>` that yields words, sentences, paragraphs, lines, JSON objects, fenced code blocks, markdown sections, or user-defined patterns.

Key properties:

- **Zero runtime dependencies.** Implemented entirely with built-in Node.js APIs and standard JavaScript.
- **Provider agnostic.** Works with any LLM API that produces streaming text. Adapters included for OpenAI and Anthropic.
- **Backpressure support.** Built on the `AsyncIterable` protocol -- if the consumer is slow, the aggregator pauses pulling from the source stream automatically.
- **Eight built-in aggregation units.** Word, sentence, paragraph, line, JSON, code block, markdown section, and custom.

---

## Installation

```bash
npm install stream-tokens
```

Requires Node.js 18 or later.

---

## Quick Start

### Sentence aggregation from an OpenAI stream

```typescript
import OpenAI from "openai";
import { fromOpenAI, sentences } from "stream-tokens";

const client = new OpenAI();
const stream = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Tell me a story." }],
  stream: true,
});

for await (const chunk of sentences(fromOpenAI(stream))) {
  console.log(chunk.content);
  // "Once upon a time, there was a small village."
  // "The villagers were kind and hardworking."
  // ...
}
```

### Word-by-word rendering from an Anthropic stream

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { fromAnthropic, words } from "stream-tokens";

const client = new Anthropic();
const stream = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Describe the ocean." }],
  stream: true,
});

for await (const chunk of words(fromAnthropic(stream))) {
  process.stdout.write(chunk.content + " ");
}
```

### JSON object extraction

```typescript
import { aggregate } from "stream-tokens";

for await (const chunk of aggregate(tokenStream, "json")) {
  const parsed = JSON.parse(chunk.content);
  console.log(parsed);
}
```

---

## Features

- **Word aggregation** -- Splits on whitespace boundaries. Handles hyphenated words (`"well-known"`), contractions (`"don't"`), and attached punctuation (`"Hello,"`) as single units.
- **Sentence aggregation** -- Splits on sentence-ending punctuation (`.`, `!`, `?`) with heuristic disambiguation. Handles abbreviations (`Dr.`, `Mr.`, `U.S.`), decimal numbers (`3.14`), ellipsis (`...`), URLs, and email addresses.
- **Paragraph aggregation** -- Splits on double newlines (`\n\n`). Handles Windows line endings (`\r\n\r\n`) and three-or-more consecutive newlines as a single boundary.
- **Line aggregation** -- Splits on single newlines. Supports `\r\n`, optional newline inclusion, and empty line skipping.
- **JSON accumulation** -- Tracks brace/bracket depth to emit complete JSON objects and arrays. Correctly handles strings containing braces, escaped quotes, nested structures, and multiple consecutive JSON values (NDJSON).
- **Code block detection** -- Detects fenced code blocks (triple backtick or tilde). Captures the language tag and fence length. Supports nested fences with differing fence lengths.
- **Markdown section splitting** -- Splits on ATX-style headings (`#` through `######`). Emits each section with heading level and text metadata. Configurable heading level range.
- **Custom boundaries** -- Accepts a user-provided `detect` function for any delimiter pattern.
- **Provider adapters** -- `fromOpenAI()` and `fromAnthropic()` extract text from provider-specific streaming response formats. Structurally typed -- no SDK imports required.
- **Flush control** -- Configurable behavior when the source stream ends: emit remaining buffer, discard it, or receive it through a callback.
- **Buffer overflow protection** -- Configurable `maxBufferSize` (default 10 MB) forces emission with `partial: true` when exceeded, preventing memory exhaustion.

---

## API Reference

### `aggregate(stream, unit, options?)`

The core aggregation function. Accepts a token stream and returns an async iterable of aggregated chunks.

```typescript
function aggregate(
  stream: AsyncIterable<string> | ReadableStream<string>,
  unit: AggregationUnit,
  options?: AggregatorOptions
): AsyncIterable<AggregatedChunk>;
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `stream` | `AsyncIterable<string> \| ReadableStream<string>` | The source token stream. |
| `unit` | `AggregationUnit` | The aggregation unit to split on. |
| `options` | `AggregatorOptions` | Optional configuration. |

**Aggregation units:**

| Unit | Splits on |
|------|-----------|
| `'word'` | Whitespace (space, tab, newline) |
| `'sentence'` | Period, exclamation, question mark (with abbreviation/decimal awareness) |
| `'paragraph'` | Double newline (`\n\n`) |
| `'line'` | Single newline (`\n`) |
| `'json'` | Complete JSON objects/arrays (depth tracking) |
| `'code-block'` | Fenced code blocks (triple backtick or tilde) |
| `'markdown-section'` | ATX-style markdown headings |
| `'custom'` | User-provided `detect` function |

**Example:**

```typescript
import { aggregate } from "stream-tokens";

for await (const chunk of aggregate(tokenStream, "word")) {
  console.log(chunk.content); // complete word
  console.log(chunk.unit); // 'word'
  console.log(chunk.index); // 0, 1, 2, ...
  console.log(chunk.partial); // false (true if flushed before boundary)
}
```

---

### Convenience Shorthands

Each aggregation unit has a shorthand function that calls `aggregate()` with the unit preset.

```typescript
function words(stream, options?): AsyncIterable<AggregatedChunk>;
function sentences(stream, options?): AsyncIterable<AggregatedChunk>;
function lines(stream, options?): AsyncIterable<AggregatedChunk>;
function paragraphs(stream, options?): AsyncIterable<AggregatedChunk>;
function jsonObjects(stream, options?): AsyncIterable<AggregatedChunk>;
function codeBlocks(stream, options?): AsyncIterable<AggregatedChunk>;
function markdownSections(stream, options?): AsyncIterable<AggregatedChunk>;
```

All shorthands accept `AsyncIterable<string> | ReadableStream<string>` as the first argument and optional `AggregatorOptions` as the second.

```typescript
import {
  words,
  sentences,
  lines,
  paragraphs,
  jsonObjects,
  codeBlocks,
  markdownSections,
} from "stream-tokens";

for await (const chunk of words(tokenStream)) {
  /* ... */
}
for await (const chunk of sentences(tokenStream)) {
  /* ... */
}
for await (const chunk of lines(tokenStream)) {
  /* ... */
}
for await (const chunk of paragraphs(tokenStream)) {
  /* ... */
}
for await (const chunk of jsonObjects(tokenStream)) {
  /* ... */
}
for await (const chunk of codeBlocks(tokenStream)) {
  /* ... */
}
for await (const chunk of markdownSections(tokenStream)) {
  /* ... */
}
```

---

### Boundary Detectors

Low-level boundary detection functions are exported for direct use, testing, or building custom aggregation logic.

#### `detectWordBoundary(buffer, options)`

Scans the buffer for whitespace after a non-whitespace sequence. Returns a `BoundaryResult` or `null`.

```typescript
import { detectWordBoundary } from "stream-tokens";

const result = detectWordBoundary("hello world", {});
// { boundaryEnd: 5, nextStart: 6 }
```

#### `detectLineBoundary(buffer, options)`

Scans the buffer for `\n`. Returns a `BoundaryResult` or `null`. Handles `\r\n` as a single newline.

```typescript
import { detectLineBoundary } from "stream-tokens";

const result = detectLineBoundary("line1\nline2", {});
// { boundaryEnd: 5, nextStart: 6 }
```

#### `detectParagraphBoundary(buffer, options)`

Scans the buffer for `\n\n` or `\r\n\r\n`. Returns a `BoundaryResult` or `null`.

```typescript
import { detectParagraphBoundary } from "stream-tokens";

const result = detectParagraphBoundary("para1\n\npara2", {});
// { boundaryEnd: 5, nextStart: 7 }
```

#### `detectJsonBoundary(buffer, options)`

Tracks brace/bracket depth to find complete JSON objects or arrays. Returns a `BoundaryResult` with `metadata.type` (`'object'` or `'array'`) and `metadata.depth`, or `null`.

```typescript
import { detectJsonBoundary } from "stream-tokens";

const result = detectJsonBoundary('{"name": "Alice"}', {});
// { boundaryEnd: 17, nextStart: 17, contentStart: 0, metadata: { type: 'object', depth: 0 } }
```

#### `detectCodeBlockBoundary(buffer, options)`

Detects fenced code blocks delimited by triple backticks or tildes. Returns a `BoundaryResult` with `metadata.language` and `metadata.fenceLength`, or `null`.

```typescript
import { detectCodeBlockBoundary } from "stream-tokens";

const result = detectCodeBlockBoundary("```typescript\nconst x = 1;\n```\n", {});
// { boundaryEnd: 32, nextStart: 32, metadata: { language: 'typescript', fenceLength: 3 } }
```

#### `detectMarkdownSectionBoundary(buffer, options)`

Detects ATX-style heading boundaries. Returns a `BoundaryResult` with `metadata.level` (1-6) and `metadata.heading`, or `null`. Content before the first heading is emitted with `metadata.level: 0`.

```typescript
import { detectMarkdownSectionBoundary } from "stream-tokens";

const result = detectMarkdownSectionBoundary("# Intro\ntext\n# Methods\ntext", {});
// { boundaryEnd: 13, nextStart: 13, metadata: { level: 1, heading: 'Intro' } }
```

---

### Provider Adapters

Adapters convert provider-specific streaming formats into plain `AsyncIterable<string>` that `aggregate()` consumes. They are structurally typed -- no provider SDK import is required at the type level.

#### `fromOpenAI(stream)`

Extracts text content from OpenAI chat completion streaming responses.

```typescript
function fromOpenAI(
  stream: AsyncIterable<{
    choices: Array<{ delta: { content?: string | null } }>;
  }>
): AsyncIterable<string>;
```

Yields `choices[0].delta.content` for each chunk where the content is a non-null, non-empty string. Skips role deltas, finish reasons, tool calls, and null content.

```typescript
import { fromOpenAI, sentences } from "stream-tokens";

const stream = await openai.chat.completions.create({ stream: true /* ... */ });
for await (const chunk of sentences(fromOpenAI(stream))) {
  console.log(chunk.content);
}
```

#### `fromAnthropic(stream)`

Extracts text content from Anthropic message streaming responses.

```typescript
function fromAnthropic(
  stream: AsyncIterable<{
    type: string;
    delta?: { type?: string; text?: string };
  }>
): AsyncIterable<string>;
```

Yields `delta.text` only for events where `type === 'content_block_delta'` and `delta.type === 'text_delta'`. Skips `message_start`, `content_block_start`, `content_block_stop`, `message_delta`, and `message_stop` events.

```typescript
import { fromAnthropic, words } from "stream-tokens";

const stream = await anthropic.messages.create({ stream: true /* ... */ });
for await (const chunk of words(fromAnthropic(stream))) {
  console.log(chunk.content);
}
```

---

## Configuration

All options are passed through the `AggregatorOptions` object as the third argument to `aggregate()` or the second argument to any convenience shorthand.

### General Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `flush` | `'emit' \| 'discard' \| 'callback'` | `'emit'` | Behavior when the source stream ends with buffered content. |
| `onFlush` | `(content: string, unit: AggregationUnit) => void` | -- | Callback invoked when `flush` is `'callback'`. Receives the remaining buffer content and unit type. |
| `maxBufferSize` | `number` | `10_000_000` | Maximum buffer size in characters. When exceeded, the buffer is force-emitted with `partial: true`. |

### Word Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trimWhitespace` | `boolean` | `true` | Trim whitespace from emitted word content. |
| `includeWhitespace` | `boolean` | `false` | Include trailing whitespace in the emitted word content. |
| `preservePunctuation` | `boolean` | `true` | Keep punctuation attached to words (e.g., `"Hello,"` instead of `"Hello"`). |

### Sentence Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `abbreviations` | `string[]` | -- | Additional abbreviations beyond the built-in list. Values are matched case-insensitively. |

The built-in abbreviation list includes: Mr, Mrs, Ms, Dr, Prof, Sr, Jr, vs, etc, inc, ltd, corp, dept, est, fig, approx, misc, U.S, U.K, e.g, i.e, No, Vol, Jan, Feb, Mar, Apr, Jun, Jul, Aug, Sep, Oct, Nov, Dec, St, Ave, Blvd, Gen, Gov, Lt, Mt, Rev, Sgt, Spc, Supt, al, div, govt, assn, bros, co, ed, intl, natl, univ.

### Line Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `includeNewline` | `boolean` | `false` | Include the `\n` character in emitted line content. |
| `skipEmpty` | `boolean` | `false` | Skip empty lines instead of emitting them. |

### Paragraph Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trimWhitespace` | `boolean` | `true` | Trim trailing whitespace from emitted paragraph content. |
| `minParagraphLength` | `number` | `1` | Minimum character count for a paragraph to be emitted. |

### JSON Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowMultiple` | `boolean` | `true` | Emit multiple JSON values from a single stream (NDJSON support). |

### Code Block Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `includeDelimiters` | `boolean` | `true` | Include the opening and closing fence lines in emitted content. |

### Markdown Section Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minLevel` | `number` | `1` | Minimum heading level to split on (1 = `#`). |
| `maxLevel` | `number` | `6` | Maximum heading level to split on (6 = `######`). |

### Custom Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `detect` | `(buffer: string) => BoundaryResult \| null` | -- | User-provided boundary detection function. Required when `unit` is `'custom'`. |

### Flush Modes

- **`'emit'`** (default) -- Emit remaining buffer as a final chunk. The `partial` flag is set to `true` if the content does not end at a natural boundary for the unit.
- **`'discard'`** -- Silently discard the remaining buffer. No final chunk is emitted.
- **`'callback'`** -- Call `onFlush(content, unit)` with the remaining buffer content. No chunk is emitted to the async iterable.

---

## Error Handling

Errors from the source stream propagate through the aggregator to the consumer. If the source `AsyncIterable` throws during iteration, the error surfaces in the consumer's `for await...of` loop.

```typescript
try {
  for await (const chunk of sentences(tokenStream)) {
    console.log(chunk.content);
  }
} catch (error) {
  console.error("Stream error:", error);
}
```

**Buffer overflow:** When the internal buffer exceeds `maxBufferSize` (default 10 MB) without finding a boundary, the entire buffer is force-emitted as a single chunk with `partial: true`. The aggregator then continues processing normally. This prevents memory exhaustion from pathological streams that never produce boundaries.

**Partial chunks:** When the source stream ends with buffered content that does not form a complete unit, the chunk is emitted with `partial: true` (when using the default `flush: 'emit'` mode). Check the `partial` flag to distinguish between complete and incomplete units.

```typescript
for await (const chunk of jsonObjects(tokenStream)) {
  if (chunk.partial) {
    console.warn("Incomplete JSON received:", chunk.content);
    continue;
  }
  const parsed = JSON.parse(chunk.content);
  process.stdout.write(JSON.stringify(parsed));
}
```

---

## Advanced Usage

### Custom Boundary Detection

Use the `'custom'` unit with a `detect` function to split on any delimiter pattern.

```typescript
import { aggregate } from "stream-tokens";

// Split on [STEP] markers
const detect = (buffer: string) => {
  const idx = buffer.indexOf("[STEP]");
  if (idx === -1) return null;
  return { boundaryEnd: idx, nextStart: idx + 6 };
};

for await (const chunk of aggregate(tokenStream, "custom", { detect })) {
  console.log(`Step ${chunk.index}:`, chunk.content);
}
```

### Structured Output Pipeline

Extract and parse JSON from LLM responses that mix prose with structured data.

```typescript
import { fromOpenAI, jsonObjects } from "stream-tokens";

const stream = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: "Return a JSON object with name and age for Alice, age 30.",
    },
  ],
  stream: true,
});

for await (const chunk of jsonObjects(fromOpenAI(stream))) {
  if (!chunk.partial) {
    const data = JSON.parse(chunk.content);
    console.log(data.name, data.age);
  }
}
```

### Voice AI Pipeline (Sentence-by-Sentence TTS)

Stream sentences to a text-to-speech engine as they complete, reducing voice response latency.

```typescript
import { fromAnthropic, sentences } from "stream-tokens";

const stream = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Explain quantum computing." }],
  stream: true,
});

for await (const sentence of sentences(fromAnthropic(stream))) {
  await tts.speak(sentence.content); // First sentence speaks while LLM generates the rest
}
```

### Code Block Extraction

Extract fenced code blocks from LLM responses for syntax highlighting or file writing.

```typescript
import { codeBlocks } from "stream-tokens";

for await (const block of codeBlocks(tokenStream)) {
  console.log(`Language: ${block.metadata?.language}`);
  console.log(`Fence length: ${block.metadata?.fenceLength}`);
  console.log(block.content);
}
```

### Markdown Section Processing

Split streaming markdown by heading for section-by-section rendering.

```typescript
import { markdownSections } from "stream-tokens";

for await (const section of markdownSections(tokenStream, { minLevel: 2, maxLevel: 3 })) {
  console.log(`H${section.metadata?.level}: ${section.metadata?.heading}`);
  console.log(section.content);
}
```

### NDJSON Processing

Process newline-delimited JSON streams where multiple JSON objects arrive sequentially.

```typescript
import { jsonObjects } from "stream-tokens";

for await (const chunk of jsonObjects(tokenStream)) {
  const record = JSON.parse(chunk.content);
  console.log(`Type: ${chunk.metadata?.type}`); // 'object' or 'array'
  await database.insert(record);
}
```

### Flush Callback

Use the callback flush mode to handle remaining buffer content separately from the main iteration.

```typescript
import { aggregate } from "stream-tokens";

const partials: string[] = [];

const chunks = aggregate(tokenStream, "sentence", {
  flush: "callback",
  onFlush: (content, unit) => {
    partials.push(content);
  },
});

for await (const chunk of chunks) {
  console.log(chunk.content);
}

if (partials.length > 0) {
  console.log("Incomplete final sentence:", partials[0]);
}
```

### ReadableStream Input

The `aggregate()` function and all shorthands accept both `AsyncIterable<string>` and the Web Streams API `ReadableStream<string>`.

```typescript
import { sentences } from "stream-tokens";

const response = await fetch("https://api.example.com/stream");
const readableStream = response.body!.pipeThrough(new TextDecoderStream());

for await (const chunk of sentences(readableStream)) {
  console.log(chunk.content);
}
```

---

## TypeScript

`stream-tokens` is written in TypeScript with strict mode enabled. All public types are exported.

### Exported Types

#### `AggregationUnit`

```typescript
type AggregationUnit =
  | "word"
  | "sentence"
  | "paragraph"
  | "line"
  | "json"
  | "code-block"
  | "markdown-section"
  | "custom";
```

#### `AggregatedChunk`

```typescript
interface AggregatedChunk {
  content: string; // The aggregated text
  unit: AggregationUnit; // Which unit type produced this chunk
  index: number; // Zero-based, increments per chunk
  partial: boolean; // True if emitted before natural boundary
  metadata?: ChunkMetadata; // Unit-specific metadata
}
```

#### `ChunkMetadata`

```typescript
interface ChunkMetadata {
  language?: string; // Code block: the fence language tag (e.g., 'typescript')
  fenceLength?: number; // Code block: backtick/tilde count
  level?: number; // Markdown section: heading level (1-6, or 0 for pre-heading content)
  heading?: string; // Markdown section: heading text
  depth?: number; // JSON: nesting depth when emitted (0 for complete)
  inString?: boolean; // JSON: whether inside a string when boundary found
  type?: string; // JSON: 'object' or 'array'
}
```

#### `BoundaryResult`

```typescript
interface BoundaryResult {
  boundaryEnd: number; // Exclusive end index of the completed unit in buffer
  nextStart: number; // Start index for the next unit
  contentStart?: number; // Optional: start index of actual content (skips preamble)
  metadata?: ChunkMetadata;
}
```

#### `AggregatorOptions`

```typescript
interface AggregatorOptions {
  // General
  flush?: "emit" | "discard" | "callback";
  onFlush?: (content: string, unit: AggregationUnit) => void;
  maxBufferSize?: number;

  // Word
  trimWhitespace?: boolean;
  includeWhitespace?: boolean;
  preservePunctuation?: boolean;

  // Sentence
  abbreviations?: string[];

  // Line
  includeNewline?: boolean;
  skipEmpty?: boolean;

  // Paragraph
  minParagraphLength?: number;

  // JSON
  allowMultiple?: boolean;

  // Code block
  includeDelimiters?: boolean;

  // Markdown section
  minLevel?: number;
  maxLevel?: number;

  // Custom
  detect?: (buffer: string) => BoundaryResult | null;
}
```

---

## License

MIT
