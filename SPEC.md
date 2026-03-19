# stream-tokens -- Specification

## 1. Overview

`stream-tokens` is a provider-agnostic streaming aggregation library that accepts any `AsyncIterable<string>` of raw LLM tokens and aggregates them into semantic units -- complete words, sentences, paragraphs, lines, JSON objects, fenced code blocks, or user-defined patterns -- yielding each completed unit as it forms. The result is an `AsyncIterable<AggregatedChunk>` that transforms the raw token-by-token firehose of an LLM response into meaningful, processable units with backpressure support. The library performs no network I/O, requires no API keys, and runs entirely in-process.

The gap this package fills is specific and well-defined. LLM APIs (OpenAI, Anthropic, Google Gemini, Ollama) stream responses as a sequence of small string fragments -- typically sub-word tokens. A response like "The capital of France is Paris." may arrive as nine separate events: `"The"`, `" cap"`, `"ital"`, `" of"`, `" France"`, `" is"`, `" Par"`, `"is"`, `"."`. These raw fragments are useless for downstream processing that requires semantic boundaries. A text-to-speech engine cannot produce natural-sounding audio from sub-word fragments -- it needs complete sentences. A streaming UI that renders word-by-word needs complete words, not arbitrary token splits. A JSON consumer that needs to parse structured output cannot call `JSON.parse()` on `{"name": "Al` -- it needs to accumulate tokens until a complete JSON object has formed. A markdown renderer needs to know when a fenced code block has closed before applying syntax highlighting. In every case, the consumer needs a layer between the raw token stream and its processing logic that accumulates fragments and emits complete semantic units.

No existing npm package provides streaming token aggregation as a standalone concern. The `natural` library includes a sentence tokenizer, but it operates on complete strings, not streaming input. The `sbd` (sentence boundary detection) library similarly requires a complete text buffer. `@streamparser/json` handles streaming JSON parsing but not sentence or word aggregation. `split2` splits Node.js streams on newlines but has no concept of sentences, words, JSON objects, or code blocks. The Vercel AI SDK's `streamText()` streams tokens but does not aggregate them into semantic units -- consumers receive the same raw fragments the LLM produces. Developers building voice AI, streaming UIs, or structured output pipelines currently implement their own aggregation logic from scratch: ad-hoc regex splits, manual bracket counting, custom sentence boundary heuristics. This logic is duplicated across every project, is consistently under-tested (especially edge cases like abbreviations, nested JSON strings, and escaped characters), and is never abstracted into a reusable library.

`stream-tokens` provides the aggregation primitive. It sits between the LLM stream source and the downstream consumer, accumulating raw tokens in an internal buffer, applying boundary detection logic for the configured aggregation unit, and yielding each completed unit as an `AggregatedChunk`. The library is structured around the `AsyncIterable` protocol: input is `AsyncIterable<string>`, output is `AsyncIterable<AggregatedChunk>`. This means backpressure flows naturally -- if the consumer is slow (TTS engine processing a sentence, UI rendering a paragraph), the aggregator pauses pulling from the source stream, which pauses the LLM response. No explicit flow control code is needed. Node.js Transform stream wrappers are provided for consumers that prefer the streams API, but the core is async-iterable-native.

---

## 2. Goals and Non-Goals

### Goals

- Provide an `aggregate(stream, unit, options?)` function that accepts any `AsyncIterable<string>` and an aggregation unit specifier, and returns an `AsyncIterable<AggregatedChunk>` that yields completed semantic units as they form.
- Support eight built-in aggregation units: `word`, `sentence`, `paragraph`, `line`, `json`, `code-block`, `markdown-section`, and `custom`.
- Implement sentence boundary detection that handles abbreviations (Dr., Mr., Mrs., Ms., Prof., U.S., U.K., etc.), decimal numbers (3.14), ellipsis (...), URLs (example.com), and other false positives -- not just naive period splitting.
- Implement JSON object accumulation via bracket/brace depth tracking that correctly handles strings (ignoring brackets inside JSON string values), escape sequences (`\"`), and multiple consecutive JSON objects in a stream.
- Implement fenced code block detection that accumulates content between opening and closing ``` delimiters, including the language tag.
- Provide convenience shorthand functions: `sentences(stream)`, `words(stream)`, `lines(stream)`, `jsonObjects(stream)`, `paragraphs(stream)`.
- Provide `createAggregator(unit, options?)` that returns a Node.js Transform stream for integration with the Node.js streams API.
- Support custom aggregation via a user-provided boundary detection function that receives the current buffer and returns split points.
- Handle backpressure through the `AsyncIterable` protocol: when the consumer stops pulling, the aggregator stops pulling from the source.
- Handle stream termination: when the source stream ends, flush any buffered content as a final chunk with a `partial` flag indicating whether the unit boundary was reached.
- Provide provider adapters (`fromOpenAI`, `fromAnthropic`) that extract text content from provider-specific streaming response formats and yield plain strings.
- Keep runtime dependencies at zero. The library is implemented entirely with built-in Node.js APIs and standard JavaScript.
- Target Node.js 18+ and modern JavaScript runtimes that support `AsyncIterable`.

### Non-Goals

- **Not an LLM API client.** This package does not make HTTP requests, manage API keys, or call LLM endpoints. It operates on streams that the caller has already established. Use the OpenAI SDK, Anthropic SDK, or any other LLM client to create the stream, then pass it to `stream-tokens`.
- **Not a JSON parser or validator.** This package accumulates tokens until a complete JSON object has formed and emits the raw JSON string. It does not parse the JSON into an object, validate it against a schema, or handle malformed JSON. For JSON parsing after accumulation, use `JSON.parse()`. For streaming validation, use `stream-validate` from this monorepo, which is the validation layer that sits downstream of `stream-tokens`.
- **Not an NLP library.** Sentence boundary detection uses heuristic rules (punctuation, abbreviation lists, whitespace patterns), not machine learning models. The heuristics cover the common cases well but will not match the accuracy of a full NLP sentence tokenizer like those in spaCy or Stanford NLP. This is a deliberate tradeoff: the heuristics run with zero latency overhead and zero dependencies, which is what a streaming pipeline requires.
- **Not a text-to-speech engine.** This package produces sentence-sized text chunks suitable for TTS input. It does not synthesize audio. Use OpenAI TTS, ElevenLabs, Google Cloud TTS, or any TTS SDK to convert the sentences to audio. The `voice-turn` package in this monorepo consumes sentence output from `stream-tokens` for its TTS pipeline.
- **Not a markdown parser.** Code block detection and markdown section splitting use simple delimiter matching (``` for code blocks, `#` for headings), not a full markdown AST parser. For complete markdown parsing, use `marked`, `remark`, or `markdown-it`.
- **Not a streaming framework.** This package provides one primitive: aggregation. It does not provide routing, middleware, multiplexing, or stream composition utilities. Combine it with standard Node.js stream utilities or async iterator helpers as needed.

---

## 3. Target Users and Use Cases

### Voice AI Developers (Sentence Aggregation for TTS)

Developers building conversational voice assistants that stream LLM responses through a text-to-speech engine. TTS engines produce natural-sounding audio when given complete sentences but produce choppy, robotic audio when given word fragments or sub-word tokens. The critical path is: LLM streams tokens, `stream-tokens` aggregates them into sentences, each sentence is sent to the TTS engine as it completes. This reduces voice response latency because the first sentence begins speaking while the LLM is still generating subsequent sentences. A typical integration: `for await (const sentence of sentences(llmStream)) { await tts.speak(sentence.content); }`. The `voice-turn` package in this monorepo uses `stream-tokens` for exactly this purpose.

### Streaming UI Builders (Word or Sentence Rendering)

Developers building chat interfaces or content generation UIs where LLM output appears progressively. Raw token-by-token rendering produces a jittery, hard-to-read experience because tokens split mid-word (the user sees "The cap" then "ital of" then " France"). Word-level aggregation provides smooth, readable progressive rendering. Sentence-level aggregation enables typewriter effects at the sentence level or paragraph-level page building. A typical integration: `for await (const word of words(llmStream)) { appendToDOM(word.content); }`.

### Structured Output Consumers (JSON Accumulation)

Developers whose LLM prompts request JSON-formatted responses and who receive those responses via streaming. The LLM streams tokens that gradually form a JSON object, but `JSON.parse()` fails on partial input. `stream-tokens` accumulates tokens until bracket/brace depth returns to zero, then emits the complete JSON string for parsing. This is the accumulation layer that sits beneath `stream-validate`: `stream-tokens` forms complete JSON strings, `stream-validate` parses and validates them against Zod schemas. A typical integration: `for await (const obj of jsonObjects(llmStream)) { const parsed = JSON.parse(obj.content); process(parsed); }`.

### Code Generation Tools (Code Block Extraction)

Developers building tools that extract code from LLM responses -- coding assistants, documentation generators, automated refactoring tools. LLM responses often contain fenced code blocks (```python ... ```) interspersed with explanatory text. `stream-tokens` accumulates tokens until a fenced code block closes, then emits the complete code block including the language tag. The consumer can apply syntax highlighting, write the code to a file, or execute it. The code block is emitted as a single unit rather than token-by-token, enabling correct syntax highlighting and complete extraction.

### Log and Line-Oriented Processing (Line Aggregation)

Developers processing LLM output that has line-oriented structure -- CSV generation, log analysis, step-by-step instructions. Line aggregation emits each complete line as it forms, enabling line-by-line processing of streaming output. A typical integration: `for await (const line of lines(llmStream)) { processLine(line.content); }`.

### Markdown Renderers (Section and Paragraph Aggregation)

Developers building live markdown renderers for LLM output (chat UIs, documentation tools, AI writing assistants). Paragraph aggregation emits complete paragraphs (separated by blank lines) for block-level rendering. Markdown section aggregation emits content between headings, enabling section-by-section rendering with proper heading hierarchy.

### Custom Protocol Handlers (Custom Delimiter)

Developers whose LLM output uses custom delimiters -- XML-like tags, `---` separators, `[STEP]` markers, or any application-specific boundary. The `custom` aggregation unit accepts a user-provided boundary detection function, enabling aggregation for any delimiter pattern.

---

## 4. Core Concepts

### Token Stream

A token stream is the sequence of string fragments emitted by an LLM API during streaming generation. Each fragment is typically a sub-word token (the unit used by the model's tokenizer), though some APIs may emit multiple tokens per event or split tokens across events. The key property of a token stream is that fragments arrive asynchronously over time, each fragment is a small string (1-20 characters typically), and the concatenation of all fragments produces the complete response text. `stream-tokens` consumes any `AsyncIterable<string>` as a token stream -- the library is agnostic to the source's tokenization strategy.

### Aggregation Unit

An aggregation unit defines the boundary at which accumulated tokens are split and emitted. Each unit has a boundary detection algorithm that examines the internal buffer after each token is appended and determines whether a complete unit has formed. When a boundary is detected, the content up to the boundary is emitted as an `AggregatedChunk`, and the buffer is reset to any remaining content after the boundary. Built-in units are `word`, `sentence`, `paragraph`, `line`, `json`, `code-block`, `markdown-section`, and `custom`.

### Boundary Detection

Boundary detection is the process of examining the aggregation buffer to determine whether a complete semantic unit has formed. Different units use different detection algorithms: word detection splits on whitespace, sentence detection looks for sentence-ending punctuation followed by whitespace, JSON detection tracks brace/bracket depth, and code block detection matches opening and closing ``` delimiters. Boundary detection runs after every token is appended to the buffer. Some detectors (like sentence detection) use a lookahead strategy: when a potential boundary is found (e.g., a period), the detector waits for the next token to confirm the boundary before emitting.

### Lookahead Buffer

Some boundary detectors cannot make a definitive decision with the current buffer contents alone. The sentence detector, for example, cannot determine whether a period ends a sentence when it sees `"Dr."` -- it might be the abbreviation "Dr." or the end of a sentence. The lookahead buffer holds content past a potential boundary until the next token arrives and either confirms or denies the boundary. If the next token starts with a capital letter and whitespace preceded the period, the boundary is confirmed. If the next token continues the word (e.g., `" Smith"`), the boundary is denied and the buffer continues accumulating.

### Flush

Flush occurs when the source stream ends. Any content remaining in the aggregation buffer is emitted as a final `AggregatedChunk`. If the remaining content constitutes a complete unit (e.g., a sentence that ends with a period), it is emitted normally. If the content is incomplete (e.g., a partial sentence without terminal punctuation, an unclosed JSON object), it is emitted with `partial: true` in the chunk metadata. The flush behavior is configurable: the consumer can choose to receive partial units (`flush: 'emit'`, the default), discard them (`flush: 'discard'`), or receive them through a separate callback (`flush: 'callback'`).

### Backpressure

Backpressure is the mechanism by which a slow consumer signals an upstream producer to slow down. In `stream-tokens`, backpressure flows through the `AsyncIterable` protocol automatically. When the consumer's `for await...of` loop is processing a chunk (e.g., sending a sentence to a TTS engine that takes 500ms to synthesize), it does not call `.next()` on the aggregator's async iterator. The aggregator, in turn, does not call `.next()` on the source stream's async iterator. The source stream (typically backed by a network socket) applies TCP-level backpressure to the LLM API server. No explicit flow control, buffering limits, or watermark configuration is needed for the async iterable API. The Node.js Transform stream wrapper (`createAggregator`) additionally supports `highWaterMark` for consumers that use the streams API.

### Aggregated Chunk

An `AggregatedChunk` is the output unit of the aggregation pipeline. It contains the accumulated text content, metadata about the aggregation unit, the chunk's index in the sequence, and flags indicating whether the chunk is partial or complete. Chunks are emitted in order: the first complete sentence is index 0, the second is index 1, and so on.

---

## 5. Aggregation Units

### 5.1 Word

**Purpose:** Aggregate tokens into complete words, splitting on whitespace boundaries.

**Boundary detection algorithm:**

1. After each token is appended to the buffer, scan the buffer for whitespace characters (space, tab, newline, carriage return).
2. When whitespace is found, everything before the whitespace is a complete word. Emit it.
3. Consecutive whitespace is collapsed. The whitespace itself is not included in the emitted word.
4. If the buffer contains only whitespace after a word boundary, clear it without emitting.

**Edge cases:**

- **Hyphenated words**: `"well-known"` is emitted as a single word, not two. Hyphens within a word (surrounded by non-whitespace characters) are not boundaries.
- **Contractions**: `"don't"`, `"it's"`, `"they're"` are emitted as single words. Apostrophes within a word are not boundaries.
- **Punctuation attached to words**: `"Hello,"` is emitted as `"Hello,"` with the comma attached. Punctuation is not a word boundary unless it is followed by whitespace.
- **Leading whitespace**: Tokens that begin with whitespace (e.g., `" the"`) trigger emission of the preceding word before appending the new token's non-whitespace content to the buffer.
- **Multiple words per token**: A token like `" of France"` may contain multiple words. Each word is emitted separately.
- **Unicode**: Word boundaries are detected by whitespace characters only. Non-ASCII word characters (accented letters, CJK characters) are not treated as boundaries.

**Configuration:**

```typescript
words(stream, {
  includeWhitespace: false,   // Default: strip whitespace from emitted words
  preservePunctuation: true,  // Default: keep punctuation attached to words
});
```

**Example:**

```
Input tokens:  "The" " cap" "ital" " of" " France" " is" " Par" "is" "."
Buffer states: "The" → " cap" → "capital" → " of" → " France" → " is" → " Par" → "Paris" → "."
Emitted words: "The", "capital", "of", "France", "is", "Paris."
```

### 5.2 Sentence

**Purpose:** Aggregate tokens into complete sentences, suitable for TTS input and sentence-level rendering.

**Boundary detection algorithm:**

1. After each token is appended to the buffer, scan for sentence-ending punctuation: `.`, `!`, `?`.
2. When a sentence-ending character is found, enter the lookahead state. Do not emit yet.
3. When the next token arrives, check whether the punctuation was a true sentence boundary:
   - **Confirm boundary** if the next token starts with whitespace followed by an uppercase letter, or if the next token starts with whitespace and the sentence-ending character is `!` or `?`.
   - **Deny boundary** if the punctuation is preceded by an abbreviation (see abbreviation handling below).
   - **Deny boundary** if the character is `.` and it is part of a decimal number (see decimal handling below).
   - **Deny boundary** if the punctuation is inside a quoted string and the quote has not closed (see quoted speech handling below).
4. If the boundary is confirmed, emit the content up to and including the sentence-ending punctuation (and any trailing whitespace). Reset the buffer to the content after the boundary.
5. If the boundary is denied, continue accumulating.
6. On stream end (flush), emit any remaining buffer content as the final sentence.

**Abbreviation handling:**

A built-in abbreviation list is checked when a period is encountered. If the word preceding the period matches an abbreviation, the period is not treated as a sentence boundary.

Default abbreviation list:
```
Mr, Mrs, Ms, Dr, Prof, Sr, Jr, St, Ave, Blvd, Dept, Est, Fig, Gen, Gov,
Lt, Mt, No, Rev, Sgt, Spc, Supt, Vol, vs, etc, al, approx, dept, div,
est, govt, inc, ltd, corp, assn, bros, co, ed, intl, natl, univ
```

Additionally, single-letter abbreviations followed by a period are not sentence boundaries: `A.`, `B.`, `U.`, `S.` (to handle initialisms like `U.S.A.`, `U.K.`, `J.K.`).

**Decimal number handling:**

When a period is preceded by a digit and followed by a digit, it is part of a decimal number and is not a sentence boundary. The detector checks: if the character before `.` matches `[0-9]` and the first non-whitespace character of the next token matches `[0-9]`, deny the boundary. This correctly handles `"3.14"`, `"$99.99"`, `"version 2.0"`.

**Ellipsis handling:**

Three consecutive periods (`...`) are treated as a single ellipsis. By default, an ellipsis is a sentence boundary (the sentence ends with `...`). This is configurable:

```typescript
sentences(stream, {
  ellipsisIsSentenceEnd: true,  // Default: "..." ends a sentence
});
```

When `ellipsisIsSentenceEnd` is `false`, the ellipsis is accumulated as part of the ongoing sentence, and the detector waits for a subsequent sentence-ending character.

**Quoted speech handling:**

The sentence detector tracks whether the current position is inside a quoted string (delimited by `"` or `'`). When inside a quote, periods and other punctuation are not treated as sentence boundaries. The sentence boundary is detected at the end of the entire quoted construction:

```
Input:  "Hello," she said. "How are you?"
Result: Sentence 1: '"Hello," she said.'
        Sentence 2: '"How are you?"'
```

However, this is a heuristic. The detector tracks opening and closing quotes by counting quote characters. Unmatched quotes or nested quotes may produce incorrect boundaries. The heuristic is designed for the most common patterns in LLM output.

**URL and email handling:**

Periods within URLs (`https://example.com/path`) and email addresses (`user@example.com`) are not sentence boundaries. The detector checks whether the period is preceded by characters that suggest a URL or email context (no whitespace before the period and the preceding token contains `/`, `@`, or `://`).

**Streaming challenge -- the lookahead problem:**

When the buffer contains `"The temperature is 72."`, the detector sees a period after `"72"`. Is this the end of a sentence ("The temperature is 72.") or the start of a decimal number ("The temperature is 72.5 degrees")? The detector cannot know until the next token arrives. It enters the lookahead state and waits. When the next token is `" That"`, the boundary is confirmed. When the next token is `"5"`, the boundary is denied. This lookahead adds one token of latency to sentence emission -- sentences are emitted one token after their actual boundary. For most LLM streaming use cases, this latency (a few milliseconds) is negligible.

**Configuration:**

```typescript
sentences(stream, {
  abbreviations: ['Dr', 'Mr', 'Mrs', ...],  // Custom abbreviation list (replaces default)
  additionalAbbreviations: ['Corp', 'Ltd'],  // Additions to the default list
  ellipsisIsSentenceEnd: true,               // Whether "..." ends a sentence
  minLength: 0,                              // Minimum sentence length before emitting
});
```

**Example:**

```
Input tokens:  "Dr" "." " Smith" " went" " to" " the" " store" "." " He"...
Buffer states: "Dr" → "Dr." → "Dr. Smith" → ... → "Dr. Smith went to the store."
Lookahead:     At ".", enter lookahead. Next token " He" starts with space + uppercase.
Emitted:       "Dr. Smith went to the store."
Buffer reset:  "He"...
```

### 5.3 Paragraph

**Purpose:** Aggregate tokens into complete paragraphs, split on blank lines (double newlines).

**Boundary detection algorithm:**

1. After each token is appended to the buffer, scan for the sequence `\n\n` (two consecutive newline characters, optionally with carriage returns: `\r\n\r\n`).
2. When a double newline is found, everything before it is a complete paragraph. Emit it.
3. The double newline itself is not included in the emitted paragraph. Trim trailing whitespace from the paragraph.
4. Reset the buffer to content after the double newline.

**Edge cases:**

- **More than two consecutive newlines**: Three or more newlines (`\n\n\n`) are treated as a single paragraph boundary. The extra newlines are consumed, not emitted as an empty paragraph.
- **Newlines split across tokens**: One token may end with `\n` and the next may begin with `\n`. The buffer concatenation produces `\n\n`, triggering the boundary. This works naturally because the detector scans the full buffer, not individual tokens.
- **Windows line endings**: `\r\n\r\n` is treated identically to `\n\n`.
- **Single trailing newline**: A paragraph ending with a single `\n` at stream end is emitted as a complete paragraph (the stream end acts as a paragraph boundary).

**Configuration:**

```typescript
paragraphs(stream, {
  trimWhitespace: true,  // Default: trim leading/trailing whitespace from each paragraph
});
```

### 5.4 Line

**Purpose:** Aggregate tokens into complete lines, split on newline characters.

**Boundary detection algorithm:**

1. After each token is appended to the buffer, scan for `\n` (newline character).
2. When a newline is found, everything before it is a complete line. Emit it.
3. The newline character itself is not included in the emitted line (configurable).
4. Reset the buffer to content after the newline.

**Edge cases:**

- **Carriage return**: `\r\n` is treated as a single newline. The `\r` is stripped from the emitted line.
- **Empty lines**: Two consecutive newlines emit an empty string as a line between them.
- **No trailing newline**: Content at stream end without a trailing newline is emitted as the final line (not discarded).

**Configuration:**

```typescript
lines(stream, {
  includeNewline: false,    // Default: strip the newline character from emitted lines
  skipEmpty: false,         // Default: emit empty lines
});
```

### 5.5 JSON

**Purpose:** Accumulate tokens until a complete JSON object or array is formed, then emit the raw JSON string.

**Boundary detection algorithm:**

1. Maintain a depth counter, initialized to 0.
2. Maintain a `inString` boolean, initialized to `false`.
3. Maintain an `escaped` boolean, initialized to `false`.
4. Scan each character appended to the buffer:
   - If `escaped` is `true`: set `escaped` to `false`, continue. (The character is part of an escape sequence inside a string.)
   - If the character is `\` and `inString` is `true`: set `escaped` to `true`, continue.
   - If the character is `"` and not escaped: toggle `inString`.
   - If `inString` is `true`: continue. (Brackets/braces inside strings are ignored.)
   - If the character is `{` or `[`: increment `depth`. If this is the first `{` or `[` (depth goes from 0 to 1), record the start position.
   - If the character is `}` or `]`: decrement `depth`. If depth returns to 0, a complete JSON object/array has formed. Emit the content from the recorded start position to and including this character.
5. After emitting, reset the buffer to any content after the closing character.
6. If the buffer contains more content, continue scanning (multiple JSON objects may appear in sequence).

**Edge cases:**

- **Brackets inside strings**: `{"key": "value with } brace"}` -- the `}` inside the string value does not decrement depth because `inString` is `true`.
- **Escaped quotes**: `{"key": "value with \" quote"}` -- the escaped `\"` does not toggle `inString` because the `\` sets the `escaped` flag.
- **Nested objects**: `{"outer": {"inner": 1}}` -- depth goes 0 -> 1 -> 2 -> 1 -> 0. Emitted when depth returns to 0.
- **Top-level arrays**: `[1, 2, 3]` is detected the same way as objects, using `[` and `]`.
- **Multiple JSON objects**: If the LLM streams multiple JSON objects (e.g., NDJSON format), each is emitted separately when its depth returns to 0.
- **Preamble text**: If the LLM emits text before the JSON object ("Here is the result: {...}"), characters before the first `{` or `[` are discarded. This behavior is configurable.
- **Trailing text**: Characters after the closing `}` or `]` and before the next `{` or `[` are discarded.
- **Partial JSON on stream end**: If the stream ends with depth > 0, the remaining buffer is emitted with `partial: true`. The consumer can attempt repair or discard it.

**Configuration:**

```typescript
jsonObjects(stream, {
  emitPreamble: false,     // Default: discard text before the first { or [
  emitTrailing: false,     // Default: discard text after a complete JSON object
  allowTopLevelArray: true, // Default: detect both objects and arrays
});
```

**Example:**

```
Input tokens:  "Here" " is" " the" " result" ": " "{" '"name"' ": " '"Al' "ice"' "}" " Done."
Buffer:        ...accumulating... → '{"name": "Alice"}'
Depth:         0 → 1 (at {) → 1 → 1 → 1 → 0 (at })
Emitted:       '{"name": "Alice"}'
Discarded:     "Here is the result: " (preamble), " Done." (trailing)
```

### 5.6 Code Block

**Purpose:** Accumulate tokens until a complete fenced code block (delimited by ```) is formed, then emit the entire block.

**Boundary detection algorithm:**

1. Maintain a `insideCodeBlock` boolean, initialized to `false`.
2. Maintain a `fence` string to track the opening delimiter.
3. Scan the buffer for the pattern ``` (three or more backticks) at the start of a line.
4. When an opening fence is found (not inside a code block):
   - Set `insideCodeBlock` to `true`.
   - Record the fence string (the exact sequence of backticks, e.g., ``` or ````).
   - Record the language tag (characters after the backticks on the same line, e.g., `python`).
   - Record the start position.
5. When a closing fence is found (inside a code block, matching the opening fence's backtick count, at the start of a line):
   - Set `insideCodeBlock` to `false`.
   - Emit the complete code block from start position to closing fence (inclusive).
6. Content outside code blocks is discarded (not emitted by this unit).

**Edge cases:**

- **Backticks inside code**: Inline backticks within the code content (`` ` `` or ``` `` ```) do not close the block. Only a fence at the start of a line with matching backtick count closes the block.
- **Nested code fences**: A four-backtick fence (````) can contain three-backtick fences (```) without premature closing. The closing fence must match the opening fence's backtick count.
- **Language tag**: The language tag after the opening fence (```python) is captured in the chunk metadata as `metadata.language`.
- **Unclosed code block**: If the stream ends while inside a code block, the buffer is emitted with `partial: true`.
- **Multiple code blocks**: Each code block is emitted as a separate chunk. Content between code blocks is discarded.

**Configuration:**

```typescript
aggregate(stream, 'code-block', {
  emitSurroundingText: false,  // Default: discard text outside code blocks
  includeFences: true,         // Default: include the ``` delimiters in emitted content
});
```

**Emitted chunk metadata:**

```typescript
{
  content: '```python\ndef hello():\n    print("world")\n```',
  unit: 'code-block',
  index: 0,
  partial: false,
  metadata: {
    language: 'python',
    fenceLength: 3,
  },
}
```

### 5.7 Markdown Section

**Purpose:** Aggregate tokens into markdown sections, splitting on heading boundaries.

**Boundary detection algorithm:**

1. Scan the buffer for markdown heading patterns: one or more `#` characters at the start of a line, followed by a space and heading text.
2. When a new heading is detected and the buffer already contains a previous section, emit the previous section (everything before the new heading).
3. The emitted section includes its heading line.
4. On stream end, emit any remaining buffered section.

**Edge cases:**

- **`#` inside code blocks**: The detector must not treat `#` inside fenced code blocks as heading boundaries. Track code block state (using the same logic as the code-block unit) and ignore `#` within code blocks.
- **Heading levels**: All heading levels (# through ######) are treated as section boundaries. The heading level is captured in the chunk metadata.
- **Setext-style headings**: Headings underlined with `===` or `---` on the following line are not detected. Only ATX-style headings (using `#`) are supported.
- **No heading at start**: If the stream begins with content before any heading, that content is emitted as a section with `metadata.level: 0` (pre-heading content).

**Configuration:**

```typescript
aggregate(stream, 'markdown-section', {
  minLevel: 1,    // Default: split on all heading levels
  maxLevel: 6,    // Default: split on all heading levels
});
```

### 5.8 Custom

**Purpose:** Allow the user to define arbitrary boundary detection logic.

**Interface:**

The user provides a `detect` function that receives the current buffer contents and returns either `null` (no boundary found) or a `BoundaryResult` indicating where to split.

```typescript
interface BoundaryResult {
  /** The index in the buffer where the boundary ends (exclusive). Content before this index is emitted. */
  boundaryEnd: number;
  /** The index in the buffer where the next unit begins. Content between boundaryEnd and nextStart is discarded. */
  nextStart: number;
}

aggregate(stream, 'custom', {
  detect: (buffer: string) => BoundaryResult | null,
});
```

**Example -- split on XML tags:**

```typescript
aggregate(stream, 'custom', {
  detect: (buffer) => {
    const match = buffer.match(/<\/step>/);
    if (match && match.index !== undefined) {
      const end = match.index + match[0].length;
      return { boundaryEnd: end, nextStart: end };
    }
    return null;
  },
});
```

---

## 6. Sentence Boundary Detection

Sentence boundary detection is the most complex aggregation unit because natural language is ambiguous. This section provides the complete algorithm used by the `sentence` unit.

### Algorithm Overview

The sentence boundary detector maintains the following state across tokens:

- `buffer`: accumulated text not yet emitted.
- `lookaheadPending`: boolean, `true` when a potential sentence boundary has been found but not yet confirmed.
- `pendingBoundaryIndex`: the index in the buffer of the potential boundary.
- `quoteDepth`: integer tracking nested quotation depth.
- `abbreviationSet`: the set of known abbreviations.

### Step-by-Step Processing

**Step 1: Append token to buffer.**

Each incoming token is concatenated to `buffer`.

**Step 2: If in lookahead state, resolve pending boundary.**

If `lookaheadPending` is `true`, the newly arrived token provides the lookahead context needed to confirm or deny the pending boundary.

- Extract the word before the pending boundary period (the "pre-period word").
- Examine the characters after the pending boundary:
  - If the next non-whitespace character is an uppercase letter: **confirm** the boundary (sentence ends at the period, new sentence starts with the uppercase letter).
  - If the next non-whitespace character is a digit: **deny** the boundary (decimal number like `72.5`).
  - If the next non-whitespace character is a lowercase letter: **deny** the boundary (likely an abbreviation or the period is not a sentence end).
  - If the next non-whitespace character is a quotation mark (`"`, `'`, `"`): **confirm** the boundary (new sentence beginning with a quote).
  - If there is no non-whitespace character yet (token was only whitespace): remain in lookahead state, wait for next token.

When confirmed: emit `buffer[0..pendingBoundaryIndex+1]` (content through the period and any trailing whitespace before the new sentence). Set `buffer` to the remainder. Reset `lookaheadPending` to `false`.

When denied: set `lookaheadPending` to `false`. Continue accumulating.

**Step 3: Scan buffer for potential boundaries.**

If not in lookahead state, scan the buffer from the last-checked position for sentence-ending punctuation (`.`, `!`, `?`).

For each candidate:

- **Exclamation mark or question mark**: These are almost always sentence boundaries. Enter lookahead state to confirm. (Exception: `?!` or `!!` sequences -- treat the sequence as a single boundary.)
- **Period**: Apply the following checks in order:
  1. **Abbreviation check**: Extract the word before the period. If it matches the abbreviation set (case-insensitive), deny the boundary.
  2. **Single-letter initial check**: If the word before the period is a single uppercase letter (`A.`, `B.`, `J.`), deny the boundary.
  3. **Decimal number check**: If the character before the period is a digit, enter lookahead. If the next character is a digit, deny (decimal). If not, confirm (sentence like "He scored 72.").
  4. **Ellipsis check**: If the period is followed by two more periods (`...`), treat as ellipsis. If `ellipsisIsSentenceEnd` is `true`, enter lookahead for confirmation. If `false`, deny.
  5. **URL/email check**: If the characters before the period contain `/`, `@`, or `://` without whitespace, deny (likely a URL or email).
  6. **Default**: Enter lookahead state for confirmation by the next token.

**Step 4: Flush on stream end.**

When the source stream ends, emit any remaining buffer content as the final sentence. If `lookaheadPending` is `true` at stream end, confirm the boundary (the end of the stream is definitive).

### Abbreviation List Management

The default abbreviation list is intentionally conservative. It includes the most common English abbreviations that are followed by a period and do not end a sentence. Users can replace or extend the list:

```typescript
// Replace the default list entirely
sentences(stream, { abbreviations: ['Dr', 'Mr', 'Inc'] });

// Add to the default list
sentences(stream, { additionalAbbreviations: ['Corp', 'Ltd', 'Mgr'] });
```

The abbreviation check is case-insensitive: `"dr."`, `"Dr."`, and `"DR."` all match.

### Limitations

- The detector is English-centric. Other languages have different sentence boundary rules (e.g., Chinese/Japanese use `。` instead of `.`, Spanish uses `!` at the start of sentences). Support for non-English languages is a future enhancement, not a v1 goal.
- The quoted speech heuristic tracks quote depth by counting `"` characters. Unmatched quotes (common in informal LLM output) may cause incorrect boundary detection.
- The abbreviation list does not cover all abbreviations in all domains. Medical, legal, and scientific text may contain domain-specific abbreviations that are not in the default list. Users should extend the list for their domain.

---

## 7. JSON Accumulation

### Overview

JSON accumulation is the process of buffering streaming tokens until a syntactically complete JSON object or array has formed. This is fundamentally different from JSON parsing: the accumulator does not interpret the JSON structure, build an object tree, or validate the JSON grammar. It counts brackets and braces while respecting string boundaries and escape sequences, and emits the raw JSON string when the depth returns to zero. Parsing is the consumer's responsibility (via `JSON.parse()` or `stream-validate`).

### State Machine

The JSON accumulator maintains four state variables:

| Variable | Type | Initial | Description |
|----------|------|---------|-------------|
| `depth` | `number` | `0` | Current nesting depth. Incremented on `{` and `[`, decremented on `}` and `]`. |
| `inString` | `boolean` | `false` | Whether the scanner is inside a JSON string literal. |
| `escaped` | `boolean` | `false` | Whether the previous character was a backslash inside a string. |
| `startIndex` | `number \| null` | `null` | The buffer index where the current JSON value starts. `null` when not inside a JSON value. |

### Character Processing Rules

Each character in the buffer is processed in order:

1. **If `escaped` is `true`**: Clear `escaped`. Continue. The character is consumed as part of an escape sequence.
2. **If `inString` is `true`**:
   - If the character is `\`: Set `escaped` to `true`. Continue.
   - If the character is `"`: Set `inString` to `false`. Continue.
   - Otherwise: Continue. Characters inside strings are not structurally significant.
3. **If `inString` is `false`**:
   - If the character is `"`: Set `inString` to `true`. Continue.
   - If the character is `{` or `[`:
     - Increment `depth`.
     - If `depth` is now `1` (transition from 0 to 1), set `startIndex` to the current position.
   - If the character is `}` or `]`:
     - Decrement `depth`.
     - If `depth` is now `0` (transition from 1 to 0): **emit**. Extract `buffer[startIndex..currentIndex+1]` as a complete JSON string. Set `startIndex` to `null`.
   - Otherwise: Continue.

### Multiple JSON Objects

If the LLM streams multiple JSON objects consecutively (e.g., in a tool-calling response that returns multiple results), each object is emitted as a separate chunk. After emitting one object, the scanner continues processing the remaining buffer. If another `{` or `[` is found, a new `startIndex` is recorded and accumulation begins again.

### Preamble and Trailing Text

LLMs frequently wrap JSON in natural language: `"Here is the JSON:\n{"name": "Alice"}\nLet me know if you need anything else."` The JSON accumulator's depth-based approach naturally handles this. Characters with `depth === 0` and no opening bracket are neither accumulated nor emitted (they are discarded by default). If the consumer needs the preamble or trailing text, they can set `emitPreamble: true` or `emitTrailing: true`, which causes non-JSON text to be emitted as separate chunks with `metadata.type: 'text'`.

### Partial JSON on Stream End

If the stream ends with `depth > 0`, the JSON object is incomplete. The accumulator emits the partial buffer with `partial: true`:

```typescript
{
  content: '{"name": "Alice", "age":',
  unit: 'json',
  index: 0,
  partial: true,
  metadata: {
    depth: 1,      // How deeply nested the incomplete JSON is
    inString: false,
  },
}
```

The consumer can attempt to repair the partial JSON (close open braces/brackets, terminate strings) or discard it. Repair is outside the scope of `stream-tokens`.

---

## 8. Backpressure

### AsyncIterable Natural Backpressure

The primary API (`aggregate`, `sentences`, `words`, etc.) returns an `AsyncIterable<AggregatedChunk>`. When consumed with `for await...of`, backpressure is automatic:

```typescript
for await (const sentence of sentences(llmStream)) {
  // This TTS call takes 500ms. During that time:
  // - The sentences() iterator is NOT called for .next()
  // - The aggregator is NOT pulling tokens from llmStream
  // - The llmStream is NOT pulling data from the network
  // Backpressure propagates all the way to the LLM API server.
  await tts.synthesize(sentence.content);
}
```

No configuration is needed. The `AsyncIterable` protocol's pull-based nature handles backpressure at every stage: consumer -> aggregator -> source stream -> network.

### Transform Stream with highWaterMark

The `createAggregator()` function returns a Node.js `Transform` stream. Consumers using the streams API (`.pipe()`, `pipeline()`) get backpressure through Node.js's built-in stream backpressure mechanism:

```typescript
const aggregator = createAggregator('sentence', { highWaterMark: 16 });
llmReadable.pipe(aggregator).pipe(ttsWritable);
```

When the `ttsWritable`'s internal buffer is full, `aggregator.write()` returns `false`, which causes `llmReadable` to pause. When `ttsWritable` drains, `llmReadable` resumes. The `highWaterMark` option controls the Transform stream's internal buffer size (number of `AggregatedChunk` objects, not bytes).

### Buffer Overflow Protection

For the async iterable API, there is no internal buffer that can overflow -- each chunk is produced on-demand when the consumer calls `.next()`. For the Transform stream API, the `highWaterMark` controls buffering. If a consumer neither uses `for await...of` nor the streams API but instead pushes tokens manually (via `createAggregator().write()`), the `maxBufferSize` option limits the aggregator's internal text buffer:

```typescript
createAggregator('sentence', {
  maxBufferSize: 1_000_000,  // Max 1MB of accumulated text before forcing emission
});
```

When `maxBufferSize` is exceeded, the aggregator emits the buffer contents as a chunk with `partial: true`, regardless of whether a boundary has been found. This prevents memory exhaustion from a pathological stream that never produces a boundary (e.g., a JSON object that is millions of characters long).

Default `maxBufferSize` is 10MB, which is well above typical LLM response sizes.

---

## 9. API Surface

### Installation

```bash
npm install stream-tokens
```

### Main Function: `aggregate`

```typescript
import { aggregate } from 'stream-tokens';

const chunks = aggregate(stream, 'sentence', options?);

for await (const chunk of chunks) {
  console.log(chunk.content);  // Complete sentence
  console.log(chunk.index);    // 0, 1, 2, ...
  console.log(chunk.partial);  // false (true only for final flush if incomplete)
}
```

**Signature:**

```typescript
function aggregate(
  stream: AsyncIterable<string> | ReadableStream<string>,
  unit: AggregationUnit,
  options?: AggregatorOptions,
): AsyncIterable<AggregatedChunk>;
```

### Shorthand Functions

Each built-in aggregation unit has a convenience function that returns `AsyncIterable<AggregatedChunk>`:

```typescript
import { sentences, words, lines, paragraphs, jsonObjects } from 'stream-tokens';

// Sentence aggregation
for await (const chunk of sentences(llmStream, options?)) { ... }

// Word aggregation
for await (const chunk of words(llmStream, options?)) { ... }

// Line aggregation
for await (const chunk of lines(llmStream, options?)) { ... }

// Paragraph aggregation
for await (const chunk of paragraphs(llmStream, options?)) { ... }

// JSON object accumulation
for await (const chunk of jsonObjects(llmStream, options?)) { ... }
```

### Transform Stream Factory: `createAggregator`

```typescript
import { createAggregator } from 'stream-tokens';

const transform = createAggregator('sentence', options?);

// Use with pipe
llmReadable.pipe(transform).on('data', (chunk: AggregatedChunk) => { ... });

// Use with pipeline
import { pipeline } from 'stream/promises';
await pipeline(llmReadable, transform, ttsWritable);
```

**Signature:**

```typescript
function createAggregator(
  unit: AggregationUnit,
  options?: AggregatorOptions & { highWaterMark?: number },
): Transform;
```

The returned `Transform` stream operates in object mode. Input chunks are strings. Output chunks are `AggregatedChunk` objects.

### Provider Adapters

```typescript
import { fromOpenAI, fromAnthropic } from 'stream-tokens';

// OpenAI: extract delta.content from streaming chat completion
const textStream = fromOpenAI(openaiStream);
for await (const sentence of sentences(textStream)) { ... }

// Anthropic: extract text delta from streaming message
const textStream = fromAnthropic(anthropicStream);
for await (const sentence of sentences(textStream)) { ... }
```

**Signatures:**

```typescript
function fromOpenAI(stream: AsyncIterable<OpenAIChatCompletionChunk>): AsyncIterable<string>;
function fromAnthropic(stream: AsyncIterable<AnthropicMessageStreamEvent>): AsyncIterable<string>;
```

The adapters are typed generically using structural typing (duck typing). They do not import OpenAI or Anthropic SDK types as dependencies. Instead, they look for the expected shape:

- **OpenAI**: Each chunk has `choices[0].delta.content` (string or null). The adapter yields non-null content strings.
- **Anthropic**: Each event has `type === 'content_block_delta'` with `delta.text` (string). The adapter yields text strings from content block delta events.

### Type Definitions

```typescript
/** The aggregation unit specifier. */
type AggregationUnit =
  | 'word'
  | 'sentence'
  | 'paragraph'
  | 'line'
  | 'json'
  | 'code-block'
  | 'markdown-section'
  | 'custom';

/** A completed aggregation chunk emitted by the aggregator. */
interface AggregatedChunk {
  /** The accumulated text content of this semantic unit. */
  content: string;

  /** Which aggregation unit this chunk represents. */
  unit: AggregationUnit;

  /** Zero-based index of this chunk in the output sequence. */
  index: number;

  /** True if this chunk is incomplete (emitted on stream end without reaching a boundary). */
  partial: boolean;

  /** Unit-specific metadata. */
  metadata?: ChunkMetadata;
}

/** Metadata specific to certain aggregation units. */
interface ChunkMetadata {
  /** For 'code-block': the language tag (e.g., 'python', 'typescript'). */
  language?: string;

  /** For 'code-block': the number of backticks in the fence. */
  fenceLength?: number;

  /** For 'markdown-section': the heading level (1-6, or 0 for pre-heading content). */
  level?: number;

  /** For 'markdown-section': the heading text. */
  heading?: string;

  /** For 'json': the nesting depth at the point of emission (0 if complete). */
  depth?: number;

  /** For 'json': whether the scanner was inside a string at point of emission. */
  inString?: boolean;

  /** For 'json': 'text' if this chunk is preamble/trailing text (when emitPreamble/emitTrailing is true). */
  type?: 'json' | 'text';
}

/** Configuration options for the aggregator. */
interface AggregatorOptions {
  // ── Sentence-specific options ──

  /** Replace the default abbreviation list. */
  abbreviations?: string[];

  /** Add to the default abbreviation list. */
  additionalAbbreviations?: string[];

  /** Whether '...' ends a sentence. Default: true. */
  ellipsisIsSentenceEnd?: boolean;

  /** Minimum sentence length (in characters) before emitting. Default: 0. */
  minLength?: number;

  // ── Word-specific options ──

  /** Include whitespace in emitted words. Default: false. */
  includeWhitespace?: boolean;

  /** Keep punctuation attached to words. Default: true. */
  preservePunctuation?: boolean;

  // ── Line-specific options ──

  /** Include the newline character in emitted lines. Default: false. */
  includeNewline?: boolean;

  /** Skip empty lines. Default: false. */
  skipEmpty?: boolean;

  // ── Paragraph-specific options ──

  /** Trim leading/trailing whitespace from paragraphs. Default: true. */
  trimWhitespace?: boolean;

  // ── JSON-specific options ──

  /** Emit text before the first JSON object as a chunk. Default: false. */
  emitPreamble?: boolean;

  /** Emit text after a JSON object as a chunk. Default: false. */
  emitTrailing?: boolean;

  /** Detect top-level arrays in addition to objects. Default: true. */
  allowTopLevelArray?: boolean;

  // ── Code block-specific options ──

  /** Emit text outside code blocks. Default: false. */
  emitSurroundingText?: boolean;

  /** Include the ``` delimiters in emitted content. Default: true. */
  includeFences?: boolean;

  // ── Markdown section-specific options ──

  /** Minimum heading level to split on. Default: 1. */
  minLevel?: number;

  /** Maximum heading level to split on. Default: 6. */
  maxLevel?: number;

  // ── Custom-specific options ──

  /** User-provided boundary detection function. Required for 'custom' unit. */
  detect?: (buffer: string) => BoundaryResult | null;

  // ── General options ──

  /** What to do with buffered content when the stream ends. Default: 'emit'. */
  flush?: 'emit' | 'discard' | 'callback';

  /** Callback for partial content on stream end (used when flush is 'callback'). */
  onFlush?: (content: string, unit: AggregationUnit) => void;

  /** Maximum buffer size in bytes before forcing emission. Default: 10_000_000 (10MB). */
  maxBufferSize?: number;
}

/** Result from a custom boundary detection function. */
interface BoundaryResult {
  /** The index in the buffer where the boundary ends (exclusive). */
  boundaryEnd: number;

  /** The index in the buffer where the next unit begins. */
  nextStart: number;
}
```

---

## 10. Stream Compatibility

### Input Formats

`stream-tokens` accepts the following input types:

| Input Type | How It Is Consumed |
|------------|-------------------|
| `AsyncIterable<string>` | Used directly. This is the universal interface. Async generators, Node.js Readable streams (which implement `Symbol.asyncIterator`), and any custom async iterable all work. |
| `ReadableStream<string>` (Web Streams API) | Adapted to `AsyncIterable` via the stream's `[Symbol.asyncIterator]()` method (supported in Node.js 18+) or a manual `getReader()` loop as a fallback. |
| `Readable` (Node.js stream) | Consumed via `Symbol.asyncIterator`, which Node.js Readable streams implement natively since Node.js 10. The stream must produce string chunks (not Buffers). Call `readable.setEncoding('utf-8')` if needed. |

### Provider-Specific Streams

LLM provider SDKs return streams in provider-specific formats. The provider adapters (`fromOpenAI`, `fromAnthropic`) handle the format translation. Users of other providers can write a simple async generator adapter:

```typescript
// Generic adapter for any provider
async function* extractText(providerStream: AsyncIterable<any>): AsyncIterable<string> {
  for await (const event of providerStream) {
    const text = extractTextFromEvent(event); // Provider-specific extraction
    if (text) yield text;
  }
}

for await (const sentence of sentences(extractText(myStream))) { ... }
```

### OpenAI Streaming Format

OpenAI's chat completion streaming response is an `AsyncIterable` of chunks with the shape:

```typescript
interface OpenAIChatCompletionChunk {
  choices: Array<{
    delta: {
      content?: string | null;
      role?: string;
    };
    finish_reason: string | null;
  }>;
}
```

The `fromOpenAI` adapter yields `choices[0].delta.content` when it is a non-null, non-empty string. All other events (role deltas, finish reasons, tool calls) are skipped.

### Anthropic Streaming Format

Anthropic's message streaming response is an `AsyncIterable` of server-sent events with various types:

```typescript
interface AnthropicMessageStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
  // For content_block_delta:
  delta?: {
    type: 'text_delta';
    text: string;
  };
}
```

The `fromAnthropic` adapter yields `delta.text` from events where `type === 'content_block_delta'` and `delta.type === 'text_delta'`. All other event types are skipped.

---

## 11. Provider Adapters

### `fromOpenAI`

```typescript
import { fromOpenAI, sentences } from 'stream-tokens';
import OpenAI from 'openai';

const openai = new OpenAI();
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Tell me about Paris.' }],
  stream: true,
});

// response is AsyncIterable<ChatCompletionChunk>
const textStream = fromOpenAI(response);
for await (const sentence of sentences(textStream)) {
  console.log(sentence.content);
}
```

**Implementation:**

```typescript
async function* fromOpenAI(
  stream: AsyncIterable<{ choices: Array<{ delta: { content?: string | null } }> }>,
): AsyncIterable<string> {
  for await (const chunk of stream) {
    const content = chunk.choices?.[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}
```

### `fromAnthropic`

```typescript
import { fromAnthropic, sentences } from 'stream-tokens';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();
const stream = anthropic.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Tell me about Paris.' }],
});

const textStream = fromAnthropic(stream);
for await (const sentence of sentences(textStream)) {
  console.log(sentence.content);
}
```

**Implementation:**

```typescript
async function* fromAnthropic(
  stream: AsyncIterable<{ type: string; delta?: { type?: string; text?: string } }>,
): AsyncIterable<string> {
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
      yield event.delta.text;
    }
  }
}
```

### No Adapter Needed

Any `AsyncIterable<string>` works directly with `aggregate` and its shorthands. If the consumer is already extracting text from a provider stream, no adapter is needed:

```typescript
// Ollama, LM Studio, or any provider that yields plain strings
async function* ollamaStream(): AsyncIterable<string> {
  // ... pull tokens from Ollama API
  yield token;
}

for await (const sentence of sentences(ollamaStream())) { ... }
```

---

## 12. Flush Behavior

### What Happens When the Stream Ends

When the source `AsyncIterable` or `ReadableStream` completes (the iterator returns `{ done: true }`), the aggregator must decide what to do with any content remaining in the buffer.

### Flush Modes

| Mode | Behavior | Use When |
|------|----------|----------|
| `'emit'` (default) | Emit the remaining buffer as a final `AggregatedChunk` with `partial: true` if the buffer content does not end at a unit boundary, or `partial: false` if it does. | Always appropriate. Most consumers want all content, even if the last unit is incomplete. |
| `'discard'` | Discard the remaining buffer silently. No final chunk is emitted. | When incomplete units are useless (e.g., partial JSON that cannot be parsed). |
| `'callback'` | Call `onFlush(content, unit)` with the remaining buffer instead of emitting it as a chunk. | When the consumer wants to handle partial content differently than complete chunks (e.g., log it, attempt repair, or merge it with the previous chunk). |

### Partial Flag Semantics

The `partial` field on `AggregatedChunk` is `true` when the chunk was emitted due to stream end or buffer overflow, and the content does not end at a natural boundary for its aggregation unit. Specifically:

- **word**: `partial: true` if the buffer does not end with whitespace (the word may be incomplete).
- **sentence**: `partial: true` if the buffer does not end with sentence-ending punctuation.
- **paragraph**: `partial: true` if the buffer does not end with a double newline.
- **line**: `partial: false` always (stream end is an implicit newline -- the final line is always complete).
- **json**: `partial: true` if the bracket/brace depth is > 0 (the JSON object is unclosed).
- **code-block**: `partial: true` if inside an unclosed code block.
- **markdown-section**: `partial: false` always (stream end is an implicit section boundary).

---

## 13. Configuration Reference

### Full Options Object

```typescript
const options: AggregatorOptions = {
  // ── Aggregation behavior ──
  flush: 'emit',               // 'emit' | 'discard' | 'callback'
  onFlush: undefined,          // (content: string, unit: AggregationUnit) => void
  maxBufferSize: 10_000_000,   // Maximum buffer size in bytes

  // ── Sentence options ──
  abbreviations: undefined,            // string[] — replaces default list
  additionalAbbreviations: undefined,  // string[] — extends default list
  ellipsisIsSentenceEnd: true,         // Whether '...' is a sentence boundary
  minLength: 0,                        // Minimum sentence length in characters

  // ── Word options ──
  includeWhitespace: false,    // Include whitespace in emitted words
  preservePunctuation: true,   // Keep punctuation attached to words

  // ── Line options ──
  includeNewline: false,       // Include '\n' in emitted lines
  skipEmpty: false,            // Skip empty lines

  // ── Paragraph options ──
  trimWhitespace: true,        // Trim whitespace from paragraphs

  // ── JSON options ──
  emitPreamble: false,         // Emit text before JSON
  emitTrailing: false,         // Emit text after JSON
  allowTopLevelArray: true,    // Detect arrays as well as objects

  // ── Code block options ──
  emitSurroundingText: false,  // Emit text outside code blocks
  includeFences: true,         // Include ``` in emitted content

  // ── Markdown section options ──
  minLevel: 1,                 // Minimum heading level (1 = #)
  maxLevel: 6,                 // Maximum heading level (6 = ######)

  // ── Custom options ──
  detect: undefined,           // (buffer: string) => BoundaryResult | null
};
```

### Environment Variables

None. `stream-tokens` is configured entirely through its API. No CLI, no environment variable support.

---

## 14. Integration with Other Packages

### voice-turn (Sentence Aggregation for TTS Pipeline)

`voice-turn` manages turn-taking in voice AI applications. During the `processing` state, the LLM generates a streaming text response that must be split into sentences before being sent to the TTS provider. `voice-turn` uses `stream-tokens`'s `sentences()` function internally to split the LLM output stream:

```typescript
// Inside voice-turn's pipeline coordinator
const llmStream = llmProvider.generate(transcript, context);
for await (const sentence of sentences(llmStream)) {
  await ttsProvider.synthesize(sentence.content);
  playAudio(audioData);
}
```

This integration reduces voice AI latency because the first sentence begins TTS synthesis while the LLM is still generating subsequent sentences. Without `stream-tokens`, `voice-turn` would need to implement its own sentence boundary detection, duplicating the abbreviation handling, decimal number detection, and lookahead logic.

### stream-validate (JSON Accumulation + Validation Pipeline)

`stream-validate` performs progressive Zod validation on streaming JSON. Its input is `AsyncIterable<string>` containing JSON characters. When used with an LLM stream that contains non-JSON preamble text, `stream-tokens`'s `jsonObjects()` function can serve as a preprocessing stage:

```typescript
import { jsonObjects } from 'stream-tokens';
import { streamValidate } from 'stream-validate';

// Step 1: Accumulate complete JSON objects from the LLM stream
const jsonChunks = jsonObjects(llmStream);

// Step 2: Validate each complete JSON string against a Zod schema
for await (const chunk of jsonChunks) {
  if (!chunk.partial) {
    const validated = await streamValidate(toCharStream(chunk.content), UserSchema);
    // ... process validated object
  }
}
```

The two packages are complementary: `stream-tokens` handles accumulation (forming complete JSON strings from token fragments), `stream-validate` handles validation (parsing and validating the JSON against a schema).

### ai-terminal-md (Streaming Markdown Rendering)

`ai-terminal-md` renders markdown in the terminal. When rendering streaming LLM output, it benefits from receiving complete paragraphs or markdown sections rather than raw tokens. `stream-tokens`'s paragraph or markdown-section aggregation provides natural rendering boundaries:

```typescript
import { paragraphs } from 'stream-tokens';
import { renderMarkdown } from 'ai-terminal-md';

for await (const paragraph of paragraphs(llmStream)) {
  renderMarkdown(paragraph.content);
}
```

### ai-spinner (Progress Indication During Aggregation)

`ai-spinner` displays streaming progress indicators. While `stream-tokens` aggregates tokens into sentences (which may take several hundred milliseconds of accumulation), `ai-spinner` can show a spinner or token count to indicate that content is being received even though no complete sentence has been emitted yet. The two packages can be combined by forking the stream: one branch feeds the aggregator, the other feeds the spinner's token counter.

---

## 15. Testing Strategy

### Unit Tests

Each aggregation unit has a dedicated test suite that verifies boundary detection against a comprehensive set of inputs:

**Word aggregation tests:**
- Basic word splitting on spaces.
- Tokens that split mid-word: `"hel"`, `"lo"` -> `"hello"`.
- Hyphenated words: `"well-known"` -> single word.
- Contractions: `"don't"` -> single word.
- Multiple words in a single token: `" hello world "` -> `"hello"`, `"world"`.
- Leading and trailing whitespace.
- Empty tokens (zero-length strings).
- Unicode characters.

**Sentence aggregation tests:**
- Basic sentence splitting: `"Hello. World."` -> two sentences.
- Abbreviation handling: `"Dr. Smith went home."` -> one sentence, not two.
- All default abbreviations tested.
- Decimal numbers: `"The value is 3.14 exactly."` -> one sentence.
- Ellipsis: `"Well... that's odd."` -> depends on configuration.
- Question marks and exclamation marks.
- Multiple sentence-ending punctuation: `"Really?!"` -> one boundary.
- Quoted speech: `'"Hello," she said.'` -> one sentence.
- Tokens that split mid-sentence: `"Dr"`, `"."`, `" Smith"` -> correctly identified as abbreviation.
- URLs: `"Visit example.com for details."` -> one sentence.
- Single-letter initials: `"J.K. Rowling wrote books."` -> one sentence.
- Lookahead resolution: period at end of one token, next token starts with uppercase.
- Stream end with pending lookahead.

**JSON accumulation tests:**
- Simple object: `{"key": "value"}`.
- Nested objects: `{"a": {"b": 1}}`.
- Arrays: `[1, 2, 3]`.
- Strings containing braces: `{"key": "value}with}braces"}`.
- Escaped quotes: `{"key": "val\"ue"}`.
- Multiple objects in sequence.
- Preamble text before JSON.
- Trailing text after JSON.
- Partial JSON on stream end.
- Empty object `{}` and empty array `[]`.
- Deeply nested structures (depth > 10).
- Unicode in JSON strings.

**Code block tests:**
- Basic fenced code block with language tag.
- Code block without language tag.
- Four-backtick fences containing three-backtick content.
- Unclosed code block at stream end.
- Multiple code blocks in sequence.
- Inline backticks within code blocks (not treated as boundaries).

**Line and paragraph tests:**
- Unix newlines (`\n`).
- Windows newlines (`\r\n`).
- Empty lines.
- Multiple consecutive newlines for paragraph splitting.
- No trailing newline at stream end.

### Edge Case Tests

- **Empty stream**: Source immediately returns `{ done: true }`. No chunks are emitted.
- **Single-token stream**: Source yields one token and ends. One chunk is emitted (possibly partial).
- **Single-character tokens**: Source yields one character at a time. All units must produce correct output.
- **Very large tokens**: A single token that is 1MB. Buffer handles it without issues.
- **Rapid successive chunks**: Verify that boundary detection is correct regardless of token granularity.

### Integration Tests

- OpenAI adapter: Mock an OpenAI streaming response shape, pipe through `fromOpenAI` and `sentences`, verify correct sentence output.
- Anthropic adapter: Mock an Anthropic streaming response shape, pipe through `fromAnthropic` and `sentences`, verify correct sentence output.
- Transform stream: Verify that `createAggregator` works correctly with `pipeline()` and `.pipe()`.
- Backpressure: Verify that a slow consumer causes the source to pause (using a controllable mock stream).
- Buffer overflow: Verify that `maxBufferSize` triggers forced emission.

### Performance Tests

- Measure aggregation overhead per token for each unit type. Target: < 1 microsecond per token for word, sentence, line, paragraph. < 5 microseconds per token for JSON (due to string/escape tracking).
- Measure memory usage: buffer size should be proportional to the current aggregation unit's content, not the total stream size.
- Measure throughput: process 100,000 tokens/second without bottlenecking the pipeline.

---

## 16. Performance

### Overhead Per Token

The aggregation logic runs synchronously for each incoming token. The cost is dominated by:

1. **String concatenation**: Appending the token to the buffer (`buffer += token`). For V8, string concatenation is O(n) in the worst case when the string is too large for the rope optimization, but for typical LLM response sizes (< 100KB), V8's rope-based string representation keeps this efficient.
2. **Boundary scan**: Scanning the buffer (or just the newly appended region) for boundary markers. For word, line, and paragraph units, this is a simple character scan -- O(k) where k is the token length. For sentence, this includes abbreviation list lookup -- O(k * a) where a is the number of abbreviations, mitigated by using a `Set` for O(1) lookup. For JSON, this is a character-by-character state machine update -- O(k).

**Target overhead per token:**

| Unit | Overhead | Reason |
|------|----------|--------|
| word | < 0.5 us | Simple whitespace scan |
| line | < 0.5 us | Simple newline scan |
| paragraph | < 0.5 us | Simple double-newline scan |
| sentence | < 2 us | Punctuation scan + abbreviation Set lookup + lookahead |
| json | < 3 us | Character-by-character state machine |
| code-block | < 1 us | Backtick pattern scan |
| markdown-section | < 1 us | Heading pattern scan |
| custom | depends | User-provided function |

These overheads are negligible compared to the LLM token generation latency (typically 10-50ms per token for cloud APIs). The aggregator is never the bottleneck.

### Memory Usage

The aggregator's memory footprint is the size of the internal buffer (the accumulated text of the current, not-yet-emitted unit) plus a small fixed overhead for state variables. Buffer size depends on the aggregation unit and the content:

- **word**: Buffer holds at most one word (typically 1-20 characters). Memory: negligible.
- **sentence**: Buffer holds at most one sentence (typically 10-200 characters). Memory: negligible.
- **paragraph**: Buffer holds at most one paragraph (typically 100-2000 characters). Memory: negligible.
- **json**: Buffer holds an entire JSON object. For large JSON responses, this can be 10KB-1MB. Memory: proportional to the JSON object size.
- **code-block**: Buffer holds an entire code block. Memory: proportional to code block size.

The `maxBufferSize` configuration provides a hard cap on memory usage for all units.

---

## 17. Dependencies

### Runtime Dependencies

None. `stream-tokens` has zero runtime dependencies. It uses only built-in Node.js APIs and standard JavaScript:

- `AsyncIterable` / `Symbol.asyncIterator` (ES2018)
- `Transform` stream (Node.js `stream` module)
- `Set` for abbreviation lookup (ES2015)
- `RegExp` for pattern matching (ES2015)

### Peer Dependencies

None. The provider adapters (`fromOpenAI`, `fromAnthropic`) accept structurally typed inputs and do not import provider SDK types. No peer dependency on `openai` or `@anthropic-ai/sdk` is required.

### Dev Dependencies

- `typescript` (^5.0.0): Compilation.
- `vitest` (^1.0.0): Test runner.
- `eslint` (^8.0.0): Linting.

---

## 18. File Structure

```
stream-tokens/
  package.json
  tsconfig.json
  SPEC.md
  README.md
  src/
    index.ts                    # Public API exports
    aggregate.ts                # Core aggregate() function and async iterable logic
    transform.ts                # createAggregator() Transform stream factory
    types.ts                    # TypeScript type definitions
    units/
      word.ts                   # Word boundary detector
      sentence.ts               # Sentence boundary detector (with abbreviation list)
      paragraph.ts              # Paragraph boundary detector
      line.ts                   # Line boundary detector
      json.ts                   # JSON accumulator (bracket/brace depth tracker)
      code-block.ts             # Code block fence detector
      markdown-section.ts       # Markdown heading boundary detector
      custom.ts                 # Custom boundary detector wrapper
    adapters/
      openai.ts                 # fromOpenAI() adapter
      anthropic.ts              # fromAnthropic() adapter
    abbreviations.ts            # Default abbreviation list
  src/__tests__/
    word.test.ts
    sentence.test.ts
    paragraph.test.ts
    line.test.ts
    json.test.ts
    code-block.test.ts
    markdown-section.test.ts
    custom.test.ts
    aggregate.test.ts           # Integration tests for the aggregate() function
    transform.test.ts           # Tests for the Transform stream wrapper
    adapters.test.ts            # Tests for provider adapters
    backpressure.test.ts        # Backpressure behavior tests
    flush.test.ts               # Flush behavior tests
  dist/                         # Compiled output (not checked in)
```

---

## 19. Implementation Roadmap

### Phase 1: Core Infrastructure

1. Define TypeScript types (`AggregatedChunk`, `AggregationUnit`, `AggregatorOptions`, `BoundaryResult`).
2. Implement the core `aggregate()` function: accepts `AsyncIterable<string>` and a boundary detector, returns `AsyncIterable<AggregatedChunk>`. Handles buffering, boundary scanning, index tracking, and flush.
3. Implement `ReadableStream` to `AsyncIterable` adaptation for Web Streams compatibility.
4. Write tests for the core loop (empty stream, single token, flush behavior, max buffer size).

### Phase 2: Basic Aggregation Units

5. Implement `word` boundary detector. Write tests.
6. Implement `line` boundary detector. Write tests.
7. Implement `paragraph` boundary detector. Write tests.
8. Implement shorthand functions (`words()`, `lines()`, `paragraphs()`).

### Phase 3: Sentence Boundary Detection

9. Implement the abbreviation list and `Set`-based lookup.
10. Implement the sentence boundary detector with lookahead, abbreviation handling, decimal detection, ellipsis handling, and URL detection.
11. Write comprehensive sentence boundary tests (the largest test suite in the project).
12. Implement the `sentences()` shorthand.

### Phase 4: JSON and Code Block Aggregation

13. Implement the JSON accumulator (bracket/brace depth, string tracking, escape handling).
14. Write JSON accumulation tests (nested objects, strings with braces, multiple objects, partial JSON).
15. Implement the code block detector (fence matching, language tag extraction).
16. Write code block tests.
17. Implement `jsonObjects()` shorthand.

### Phase 5: Markdown Section and Custom

18. Implement the markdown section detector (heading detection, code block awareness).
19. Implement the custom unit wrapper.
20. Write tests for both.

### Phase 6: Provider Adapters and Transform Stream

21. Implement `fromOpenAI()` adapter.
22. Implement `fromAnthropic()` adapter.
23. Implement `createAggregator()` Transform stream factory with `highWaterMark` support.
24. Write integration tests for adapters and Transform stream.

### Phase 7: Backpressure and Performance

25. Write backpressure tests (slow consumer, controllable mock stream).
26. Write performance benchmarks (tokens per second, memory usage per unit).
27. Optimize hot paths if benchmarks reveal bottlenecks (likely string concatenation for large buffers -- consider using an array-of-strings buffer with lazy join).

### Phase 8: Documentation and Polish

28. Write README with installation, quick start, API reference, and examples.
29. Add JSDoc comments to all public exports.
30. Final review and version 1.0.0 release.

---

## 20. Example Use Cases

### TTS Sentence Piping (Voice AI)

Stream an LLM response through a TTS engine, speaking each sentence as it completes. The first sentence begins playing audio while the LLM is still generating the second sentence.

```typescript
import { fromOpenAI, sentences } from 'stream-tokens';
import OpenAI from 'openai';

const openai = new OpenAI();
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Explain quantum computing in simple terms.' }],
  stream: true,
});

for await (const sentence of sentences(fromOpenAI(response))) {
  // Each sentence is complete — suitable for TTS
  const audio = await tts.synthesize(sentence.content);
  await playAudio(audio);
  // Next sentence is likely already buffered or arriving
}
```

### Streaming JSON Extraction

Extract complete JSON objects from an LLM response that wraps JSON in natural language.

```typescript
import { fromAnthropic, jsonObjects } from 'stream-tokens';

const stream = anthropic.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Return a JSON object with name, age, and city for Alice.' }],
});

for await (const chunk of jsonObjects(fromAnthropic(stream))) {
  if (!chunk.partial) {
    const data = JSON.parse(chunk.content);
    console.log(data); // { name: "Alice", age: 30, city: "Portland" }
  }
}
```

### Live Markdown Rendering with Code Block Extraction

Render LLM markdown output in a terminal, extracting code blocks for separate handling.

```typescript
import { aggregate } from 'stream-tokens';

// Split on code block boundaries
for await (const chunk of aggregate(llmStream, 'code-block')) {
  if (chunk.metadata?.language) {
    // This is a complete code block — apply syntax highlighting
    highlightAndRender(chunk.content, chunk.metadata.language);
  }
}
```

### Word-Level Typing Animation

Render LLM output word-by-word in a UI with a typing animation effect.

```typescript
import { words } from 'stream-tokens';

for await (const word of words(llmStream)) {
  // Append each complete word to the DOM with a small delay
  appendToDisplay(word.content + ' ');
  await sleep(50); // 50ms between words for typing effect
}
```

### Custom Delimiter: Step-by-Step Processing

Split LLM output on custom `[STEP]` markers for a multi-step reasoning pipeline.

```typescript
import { aggregate } from 'stream-tokens';

for await (const step of aggregate(llmStream, 'custom', {
  detect: (buffer) => {
    const idx = buffer.indexOf('[STEP]');
    if (idx === -1) return null;
    return { boundaryEnd: idx, nextStart: idx + '[STEP]'.length };
  },
})) {
  console.log(`Step ${step.index + 1}:`, step.content.trim());
  await processStep(step.content);
}
```

### Line-by-Line CSV Processing

Process streaming CSV output from an LLM line by line.

```typescript
import { lines } from 'stream-tokens';

const headers: string[] = [];
for await (const line of lines(llmStream, { skipEmpty: true })) {
  const fields = line.content.split(',');
  if (line.index === 0) {
    headers.push(...fields);
  } else {
    const row = Object.fromEntries(headers.map((h, i) => [h, fields[i]]));
    await insertRow(row);
  }
}
```

### Combining with stream-validate for Validated Streaming JSON

Use `stream-tokens` to accumulate complete JSON objects, then `stream-validate` to validate each against a Zod schema.

```typescript
import { jsonObjects, fromOpenAI } from 'stream-tokens';
import { streamValidate } from 'stream-validate';
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

for await (const chunk of jsonObjects(fromOpenAI(openaiStream))) {
  if (!chunk.partial) {
    try {
      const user = UserSchema.parse(JSON.parse(chunk.content));
      console.log('Valid user:', user);
    } catch (e) {
      console.error('Invalid JSON:', e.message);
    }
  }
}
```
