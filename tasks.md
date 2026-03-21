# stream-tokens — Task Breakdown

## Phase 1: Project Setup and Core Infrastructure

- [x] **Install dev dependencies** — Add `typescript` (^5.0.0), `vitest` (^1.0.0), and `eslint` (^8.0.0) as dev dependencies in `package.json`. Verify `npm install` succeeds and all scripts (`build`, `test`, `lint`) are runnable. | Status: done

- [x] **Define TypeScript types in `src/types.ts`** — Create the type definitions file containing all public types: `AggregationUnit` (union of `'word' | 'sentence' | 'paragraph' | 'line' | 'json' | 'code-block' | 'markdown-section' | 'custom'`), `AggregatedChunk` (with fields `content`, `unit`, `index`, `partial`, `metadata?`), `ChunkMetadata` (with optional fields `language`, `fenceLength`, `level`, `heading`, `depth`, `inString`, `type`), `AggregatorOptions` (all configuration options for all units including `flush`, `onFlush`, `maxBufferSize`, sentence options, word options, line options, paragraph options, JSON options, code block options, markdown section options, custom `detect` function), and `BoundaryResult` (with `boundaryEnd` and `nextStart`). | Status: done

- [x] **Define boundary detector interface** — Define an internal interface or type for boundary detectors that each unit module will implement. A boundary detector receives the current buffer, options, and internal state, and returns boundary detection results (where to split, or null if no boundary found). This is an internal contract, not part of the public API. | Status: done

- [x] **Implement core `aggregate()` function in `src/aggregate.ts`** — Implement the main `aggregate(stream, unit, options?)` function. It should: (1) accept `AsyncIterable<string>` or `ReadableStream<string>` as input, (2) select the appropriate boundary detector based on the `unit` parameter, (3) maintain an internal buffer that tokens are appended to, (4) after each token append, invoke the boundary detector to check for completed units, (5) yield each completed unit as an `AggregatedChunk` with correct `content`, `unit`, `index` (zero-based, incrementing), `partial: false`, and any unit-specific `metadata`, (6) handle stream termination per the `flush` option (`'emit'`, `'discard'`, `'callback'`), (7) respect `maxBufferSize` (default 10MB) by forcing emission with `partial: true` when exceeded. The function must return an `AsyncIterable<AggregatedChunk>` using an async generator. | Status: done

- [x] **Implement `ReadableStream` to `AsyncIterable` adaptation** — In `src/aggregate.ts` (or a utility file), detect if the input is a `ReadableStream<string>` (Web Streams API) rather than an `AsyncIterable<string>`. If so, adapt it to an `AsyncIterable` using `[Symbol.asyncIterator]()` if available (Node.js 18+), or fall back to a manual `getReader()` loop that yields each chunk. This ensures the `aggregate()` function works with both Node.js streams and Web Streams. | Status: done

- [x] **Implement flush behavior** — In the core `aggregate()` function, handle the three flush modes when the source stream ends: (1) `'emit'` (default): emit remaining buffer as a final `AggregatedChunk`, setting `partial: true` if the content does not end at a natural boundary for the unit, or `partial: false` if it does (unit-specific logic); (2) `'discard'`: silently discard remaining buffer, emit nothing; (3) `'callback'`: call `options.onFlush(content, unit)` with the remaining buffer content. Implement the `partial` flag semantics per unit as specified: word is partial if no trailing whitespace, sentence is partial if no terminal punctuation, paragraph is partial if no trailing double newline, line is always `partial: false`, json is partial if depth > 0, code-block is partial if inside unclosed block, markdown-section is always `partial: false`. | Status: done

- [x] **Implement `maxBufferSize` overflow protection** — In the core loop, after appending each token, check if the buffer exceeds `maxBufferSize` (default 10,000,000 bytes). If exceeded and no boundary has been found, force-emit the entire buffer as a chunk with `partial: true`. This prevents memory exhaustion from pathological streams. | Status: done

- [x] **Set up `src/index.ts` exports** — Update `src/index.ts` to re-export all public API symbols: `aggregate`, `sentences`, `words`, `lines`, `paragraphs`, `jsonObjects`, `createAggregator`, `fromOpenAI`, `fromAnthropic`, and all types (`AggregatedChunk`, `AggregationUnit`, `AggregatorOptions`, `BoundaryResult`, `ChunkMetadata`). | Status: done

- [x] **Write core loop unit tests in `src/__tests__/aggregate.test.ts`** — Test the `aggregate()` function itself (independent of specific units): empty stream (source immediately done, no chunks emitted), single-token stream (one chunk emitted, possibly partial), flush modes (`'emit'`, `'discard'`, `'callback'`), `maxBufferSize` forced emission, correct `index` incrementing across multiple chunks, `ReadableStream` input adaptation, error propagation from source stream. | Status: done

---

## Phase 2: Word Boundary Detector

- [x] **Implement word boundary detector in `src/units/word.ts`** — Implement the word boundary detection algorithm: scan the buffer for whitespace characters (space, tab, newline, carriage return); when whitespace is found, everything before it is a complete word to emit; consecutive whitespace is collapsed; whitespace itself is not included in emitted words (unless `includeWhitespace: true`). Handle edge cases: hyphenated words (`"well-known"` is one word), contractions (`"don't"` is one word), punctuation attached to words (`"Hello,"` includes comma), leading whitespace in tokens triggers emission of preceding word, multiple words in a single token each emitted separately, Unicode non-ASCII characters are not word boundaries. Support options: `includeWhitespace` (default `false`), `preservePunctuation` (default `true`). | Status: done

- [x] **Implement `words()` shorthand function** — Create a convenience function `words(stream, options?)` that calls `aggregate(stream, 'word', options)` and returns `AsyncIterable<AggregatedChunk>`. | Status: done

- [x] **Write word boundary tests in `src/__tests__/word.test.ts`** — Test cases: basic word splitting on spaces; tokens that split mid-word (`"hel"`, `"lo"` -> `"hello"`); hyphenated words (`"well-known"` -> single word); contractions (`"don't"`, `"it's"`, `"they're"` -> single words); multiple words in a single token (`" hello world "` -> `"hello"`, `"world"`); leading and trailing whitespace; empty tokens (zero-length strings); Unicode characters; punctuation attached to words (`"Hello,"` -> `"Hello,"`); flush behavior (last word emitted on stream end); `includeWhitespace` option; `preservePunctuation` option; single-character tokens one character at a time. | Status: done

---

## Phase 3: Line Boundary Detector

- [ ] **Implement line boundary detector in `src/units/line.ts`** — Implement line boundary detection: scan for `\n` in the buffer; when found, everything before it is a complete line; the newline itself is not included by default (configurable via `includeNewline`). Handle edge cases: `\r\n` treated as single newline with `\r` stripped; empty lines (two consecutive newlines emit an empty string between them unless `skipEmpty: true`); content at stream end without trailing newline is emitted as the final line (always `partial: false` for lines). Support options: `includeNewline` (default `false`), `skipEmpty` (default `false`). | Status: not_done

- [ ] **Implement `lines()` shorthand function** — Create a convenience function `lines(stream, options?)` that calls `aggregate(stream, 'line', options)` and returns `AsyncIterable<AggregatedChunk>`. | Status: not_done

- [ ] **Write line boundary tests in `src/__tests__/line.test.ts`** — Test cases: basic line splitting on `\n`; Windows newlines `\r\n`; empty lines; no trailing newline at stream end; `includeNewline` option; `skipEmpty` option; multiple newlines split across tokens; single-character tokens; content with mixed `\n` and `\r\n`; stream ending with `\n` vs without. | Status: not_done

---

## Phase 4: Paragraph Boundary Detector

- [ ] **Implement paragraph boundary detector in `src/units/paragraph.ts`** — Implement paragraph boundary detection: scan for `\n\n` (or `\r\n\r\n`) in the buffer; when found, everything before it is a complete paragraph; the double newline is not included in the emitted paragraph; trim trailing whitespace by default (configurable via `trimWhitespace`). Handle edge cases: three or more consecutive newlines treated as single boundary (no empty paragraph emitted); newlines split across tokens; Windows line endings `\r\n\r\n` treated identically to `\n\n`; single trailing newline at stream end emits as complete paragraph. Support options: `trimWhitespace` (default `true`). | Status: not_done

- [ ] **Implement `paragraphs()` shorthand function** — Create a convenience function `paragraphs(stream, options?)` that calls `aggregate(stream, 'paragraph', options)` and returns `AsyncIterable<AggregatedChunk>`. | Status: not_done

- [ ] **Write paragraph boundary tests in `src/__tests__/paragraph.test.ts`** — Test cases: basic paragraph splitting on double newlines; Windows `\r\n\r\n`; three or more consecutive newlines; newlines split across tokens; `trimWhitespace` option; single paragraph (no double newline); flush at stream end; empty stream. | Status: not_done

---

## Phase 5: Sentence Boundary Detection

- [ ] **Implement abbreviation list in `src/abbreviations.ts`** — Create the default abbreviation set containing: Mr, Mrs, Ms, Dr, Prof, Sr, Jr, St, Ave, Blvd, Dept, Est, Fig, Gen, Gov, Lt, Mt, No, Rev, Sgt, Spc, Supt, Vol, vs, etc, al, approx, dept, div, est, govt, inc, ltd, corp, assn, bros, co, ed, intl, natl, univ. Store as a `Set<string>` with case-insensitive matching. Export a function that accepts optional `abbreviations` (replaces default) and `additionalAbbreviations` (extends default) and returns the final `Set`. | Status: not_done

- [ ] **Implement sentence boundary detector in `src/units/sentence.ts`** — Implement the full sentence boundary detection algorithm with the following state: `buffer`, `lookaheadPending`, `pendingBoundaryIndex`, `quoteDepth`, `abbreviationSet`. Processing steps: (1) Append token to buffer. (2) If in lookahead state, resolve pending boundary: check next non-whitespace char -- uppercase letter confirms, digit denies (decimal number), lowercase denies, quotation mark confirms; if only whitespace, remain in lookahead. (3) If not in lookahead, scan buffer for sentence-ending punctuation (`.`, `!`, `?`). For `!` and `?`, enter lookahead (handle `?!`/`!!` sequences as single boundary). For `.`: check abbreviation list (case-insensitive), single-letter initials (`A.`, `B.`), decimal numbers (digit before `.` and digit after), ellipsis (`...` -- configurable via `ellipsisIsSentenceEnd`), URL/email context (no whitespace before `.` and preceding chars contain `/`, `@`, `://`). Default: enter lookahead. (4) On flush, confirm any pending lookahead and emit remaining buffer. Support quoted speech tracking via `quoteDepth`. | Status: not_done

- [ ] **Implement sentence configuration options** — Support all sentence-specific options: `abbreviations` (replaces default list), `additionalAbbreviations` (extends default list), `ellipsisIsSentenceEnd` (default `true`), `minLength` (minimum character count before emitting, default `0`). | Status: not_done

- [ ] **Implement `sentences()` shorthand function** — Create a convenience function `sentences(stream, options?)` that calls `aggregate(stream, 'sentence', options)` and returns `AsyncIterable<AggregatedChunk>`. | Status: not_done

- [ ] **Write sentence boundary tests in `src/__tests__/sentence.test.ts`** — Comprehensive test suite covering: basic sentence splitting (`"Hello. World."` -> two sentences); abbreviation handling (`"Dr. Smith went home."` -> one sentence); test all default abbreviations individually; decimal numbers (`"The value is 3.14 exactly."` -> one sentence); ellipsis with `ellipsisIsSentenceEnd: true` and `false`; question marks and exclamation marks; multiple sentence-ending punctuation (`"Really?!"` -> one boundary); quoted speech (`'"Hello," she said.'` -> one sentence); tokens split mid-sentence (`"Dr"`, `"."`, `" Smith"` -> correctly identified as abbreviation); URLs (`"Visit example.com for details."` -> one sentence); single-letter initials (`"J.K. Rowling wrote books."` -> one sentence); lookahead resolution (period at token end, next token starts with uppercase); stream end with pending lookahead; `minLength` option; custom abbreviation lists; empty stream; single-character tokens; sentences with no terminal punctuation at stream end (partial). | Status: not_done

---

## Phase 6: JSON Accumulation

- [ ] **Implement JSON accumulator in `src/units/json.ts`** — Implement the JSON accumulation state machine with four state variables: `depth` (number, initial 0), `inString` (boolean, initial false), `escaped` (boolean, initial false), `startIndex` (number | null, initial null). Character processing rules: (1) if `escaped`, clear `escaped`, continue; (2) if `inString`: `\` sets `escaped`, `"` toggles `inString`, otherwise continue; (3) if not `inString`: `"` sets `inString`, `{`/`[` increments depth (record `startIndex` on 0->1 transition), `}`/`]` decrements depth (emit on 1->0 transition extracting buffer from `startIndex` to current position inclusive, reset `startIndex`). After emitting, continue scanning for more JSON objects. Handle preamble text (characters before first `{`/`[`, discarded by default) and trailing text (characters after `}`, discarded by default). On stream end with depth > 0, emit with `partial: true` and include `metadata.depth` and `metadata.inString`. Support options: `emitPreamble` (default `false`), `emitTrailing` (default `false`), `allowTopLevelArray` (default `true`). | Status: not_done

- [ ] **Implement JSON `emitPreamble` and `emitTrailing` options** — When `emitPreamble: true`, emit text before the first `{`/`[` as a separate chunk with `metadata.type: 'text'`. When `emitTrailing: true`, emit text after a complete JSON object (between closing `}` and next `{`) as a separate chunk with `metadata.type: 'text'`. | Status: not_done

- [ ] **Implement `jsonObjects()` shorthand function** — Create a convenience function `jsonObjects(stream, options?)` that calls `aggregate(stream, 'json', options)` and returns `AsyncIterable<AggregatedChunk>`. | Status: not_done

- [ ] **Write JSON accumulation tests in `src/__tests__/json.test.ts`** — Test cases: simple object `{"key": "value"}`; nested objects `{"a": {"b": 1}}`; arrays `[1, 2, 3]`; strings containing braces `{"key": "value}with}braces"}`; escaped quotes `{"key": "val\"ue"}`; multiple objects in sequence (NDJSON); preamble text before JSON (`"Here is the result: {...}"`); trailing text after JSON; partial JSON on stream end (depth > 0); empty object `{}` and empty array `[]`; deeply nested structures (depth > 10); Unicode in JSON strings; `emitPreamble` option; `emitTrailing` option; `allowTopLevelArray: false` (ignore arrays); metadata fields (`depth`, `inString`, `type`); single-character tokens building up a JSON object. | Status: not_done

---

## Phase 7: Code Block Detector

- [ ] **Implement code block detector in `src/units/code-block.ts`** — Implement fenced code block detection: maintain `insideCodeBlock` boolean and `fence` string. Scan buffer for triple-backtick patterns at the start of a line. On opening fence: set `insideCodeBlock = true`, record fence string (exact backtick count), extract language tag (characters after backticks on same line), record start position. On closing fence (matching backtick count, at start of a line): emit complete code block from start to closing fence inclusive, set `insideCodeBlock = false`. Content outside code blocks is discarded by default. Handle edge cases: inline backticks within code do not close block, nested fences (4-backtick containing 3-backtick), unclosed code block at stream end emitted with `partial: true`, multiple code blocks emitted as separate chunks. Emit `metadata.language` and `metadata.fenceLength`. Support options: `emitSurroundingText` (default `false`), `includeFences` (default `true`). | Status: not_done

- [ ] **Write code block tests in `src/__tests__/code-block.test.ts`** — Test cases: basic fenced code block with language tag; code block without language tag; four-backtick fences containing three-backtick content; unclosed code block at stream end (`partial: true`); multiple code blocks in sequence; inline backticks within code blocks (not treated as boundaries); `emitSurroundingText` option; `includeFences` option (with and without fence delimiters in output); metadata `language` and `fenceLength` fields; tokens split across fence delimiter; empty code block; code block with only whitespace content. | Status: not_done

---

## Phase 8: Markdown Section Detector

- [ ] **Implement markdown section detector in `src/units/markdown-section.ts`** — Implement markdown heading boundary detection: scan for ATX-style headings (`#` through `######` at start of a line followed by space). When a new heading is detected and buffer contains a previous section, emit the previous section (content before new heading). The emitted section includes its own heading line. Track code block state (reuse fence logic) to ignore `#` inside fenced code blocks. On stream end, emit remaining section. Handle edge cases: content before first heading emitted with `metadata.level: 0`; heading level captured in `metadata.level` (1-6); heading text captured in `metadata.heading`; Setext-style headings (with `===`/`---`) are NOT detected. Support options: `minLevel` (default 1), `maxLevel` (default 6) -- only split on headings within the specified level range. | Status: not_done

- [ ] **Write markdown section tests in `src/__tests__/markdown-section.test.ts`** — Test cases: basic section splitting on headings; multiple heading levels; `#` inside fenced code blocks (ignored); content before first heading (`level: 0`); `minLevel` and `maxLevel` options; heading text in metadata; stream end emits final section; empty sections; consecutive headings; tokens split across heading line. | Status: not_done

---

## Phase 9: Custom Boundary Detector

- [ ] **Implement custom boundary detector wrapper in `src/units/custom.ts`** — Implement the custom unit that delegates to the user-provided `detect` function. The `detect` function receives the current buffer string and returns either `null` (no boundary found) or a `BoundaryResult` with `boundaryEnd` (exclusive index of boundary end) and `nextStart` (index where next unit begins; content between `boundaryEnd` and `nextStart` is discarded). Validate that `options.detect` is provided when unit is `'custom'` and throw a clear error if missing. | Status: not_done

- [ ] **Write custom boundary tests in `src/__tests__/custom.test.ts`** — Test cases: custom delimiter splitting (e.g., `[STEP]` markers); XML tag splitting (`</step>`); overlapping boundary and nextStart; missing `detect` function throws error; detect function returning null (no boundary found, buffer accumulates); multiple boundaries in single buffer scan; flush behavior with custom detector; empty buffer. | Status: not_done

---

## Phase 10: Provider Adapters

- [x] **Implement OpenAI adapter in `src/adapters/openai.ts`** — Implement `fromOpenAI()` as an async generator function that accepts `AsyncIterable<{ choices: Array<{ delta: { content?: string | null } }> }>` (structurally typed, no import of OpenAI SDK). For each chunk, extract `choices[0]?.delta?.content`. If it is a non-null, non-empty string, yield it. Skip all other events (role deltas, finish reasons, tool calls, null content). | Status: done

- [x] **Implement Anthropic adapter in `src/adapters/anthropic.ts`** — Implement `fromAnthropic()` as an async generator function that accepts `AsyncIterable<{ type: string; delta?: { type?: string; text?: string } }>` (structurally typed, no import of Anthropic SDK). For each event, check if `type === 'content_block_delta'` and `delta?.type === 'text_delta'` and `delta.text` is truthy. If so, yield `delta.text`. Skip all other event types (`message_start`, `content_block_start`, `content_block_stop`, `message_delta`, `message_stop`). | Status: done

- [x] **Write provider adapter tests in `src/__tests__/adapters.test.ts`** — Test cases: OpenAI adapter with mock streaming response shape, verify correct text extraction; OpenAI adapter with null content (skipped); OpenAI adapter with empty choices array; Anthropic adapter with mock streaming events, verify only `content_block_delta` text extracted; Anthropic adapter with non-text event types (skipped); integration test: pipe mock OpenAI stream through `fromOpenAI` then `sentences`, verify correct sentence output; integration test: pipe mock Anthropic stream through `fromAnthropic` then `sentences`, verify correct sentence output. | Status: done

---

## Phase 11: Transform Stream Factory

- [ ] **Implement `createAggregator()` in `src/transform.ts`** — Implement the Transform stream factory function that returns a Node.js `Transform` stream operating in object mode. Input chunks are strings, output chunks are `AggregatedChunk` objects. The Transform stream should internally use the same boundary detection logic as `aggregate()`. Support `highWaterMark` option for the Transform stream's internal buffer (controlling backpressure in the Node.js streams API). The `_transform` method appends incoming string chunks to the buffer, runs boundary detection, and pushes completed `AggregatedChunk` objects. The `_flush` method handles stream end per the `flush` option. | Status: not_done

- [ ] **Write Transform stream tests in `src/__tests__/transform.test.ts`** — Test cases: `createAggregator('sentence')` works with `.pipe()`; works with `pipeline()` from `stream/promises`; `highWaterMark` option respected; object mode output (chunks are `AggregatedChunk` objects, not strings); flush behavior on stream end; all aggregation units work through the Transform stream; backpressure with slow downstream writable. | Status: not_done

---

## Phase 12: Backpressure and Buffer Overflow Tests

- [ ] **Write backpressure tests in `src/__tests__/backpressure.test.ts`** — Verify that the `AsyncIterable` API provides natural backpressure: create a controllable mock source stream that tracks when `.next()` is called; consume the aggregator's output with deliberate delays between iterations; verify that the source stream's `.next()` is not called while the consumer is processing a chunk. Also test the Transform stream's backpressure: verify that a slow writable causes the Transform stream to pause reading from the upstream readable. | Status: not_done

- [ ] **Write flush behavior tests in `src/__tests__/flush.test.ts`** — Dedicated tests for flush behavior across all units: verify `flush: 'emit'` emits remaining buffer with correct `partial` flag per unit; verify `flush: 'discard'` emits nothing; verify `flush: 'callback'` calls `onFlush` with correct arguments; verify `partial` flag semantics for each unit type (word, sentence, paragraph, line, json, code-block, markdown-section). | Status: not_done

- [ ] **Write buffer overflow tests** — Test `maxBufferSize` behavior: set a small `maxBufferSize` (e.g., 100 bytes), feed a stream that produces no boundaries, verify the buffer is force-emitted with `partial: true` when the limit is exceeded; verify that after forced emission the aggregator continues processing normally; test with default `maxBufferSize` (10MB) to confirm it does not trigger on normal input. | Status: not_done

---

## Phase 13: Edge Case and Integration Tests

- [ ] **Write empty stream edge case tests** — Verify behavior when the source `AsyncIterable` immediately returns `{ done: true }` with no tokens: no chunks should be emitted for any unit type; no errors should be thrown. | Status: not_done

- [ ] **Write single-token stream tests** — Source yields exactly one token then ends: verify one chunk is emitted (possibly partial depending on unit); verify correct `index: 0`. | Status: not_done

- [ ] **Write single-character token tests** — Source yields one character at a time for a complete response: verify all aggregation units produce correct output identical to multi-character token input; this validates that boundary detection works regardless of token granularity. | Status: not_done

- [ ] **Write very large token tests** — Source yields a single token that is 1MB: verify the buffer handles it without issues; verify boundary detection works correctly on the large buffer. | Status: not_done

- [ ] **Write error propagation tests** — Verify that if the source `AsyncIterable` throws an error, the error propagates to the consumer of the aggregator's output (both `AsyncIterable` and Transform stream APIs). | Status: not_done

- [ ] **Write end-to-end integration test: OpenAI -> sentences -> consumption** — Create a mock OpenAI streaming response (multiple chunks forming several sentences with abbreviations and decimal numbers), pipe through `fromOpenAI` and `sentences`, verify each emitted sentence is correct, complete, and in order. | Status: not_done

- [ ] **Write end-to-end integration test: Anthropic -> jsonObjects -> consumption** — Create a mock Anthropic streaming response containing JSON wrapped in natural language, pipe through `fromAnthropic` and `jsonObjects`, verify the complete JSON object is emitted, preamble/trailing text is discarded, and partial flag is correct. | Status: not_done

---

## Phase 14: Performance Benchmarks

- [ ] **Write performance benchmark: tokens per second per unit** — Measure aggregation overhead per token for each unit type. Generate a realistic mock stream of 100,000+ tokens, run each aggregation unit, measure time. Target: < 1 microsecond/token for word, line, paragraph; < 2 microseconds/token for sentence; < 3 microseconds/token for JSON. Ensure the aggregator is never the bottleneck. | Status: not_done

- [ ] **Write performance benchmark: memory usage** — Measure memory usage during aggregation for each unit type. Verify buffer size is proportional to the current aggregation unit's content, not the total stream size. Verify no memory leaks (process multiple streams in sequence, memory should stabilize). | Status: not_done

- [ ] **Optimize hot paths if needed** — Based on benchmark results, optimize if necessary. Likely candidates: string concatenation for large buffers (consider array-of-strings buffer with lazy join), abbreviation set lookup (ensure `Set` is used for O(1) lookup), JSON character scanning (minimize per-character overhead). Only optimize if benchmarks show a problem. | Status: not_done

---

## Phase 15: Documentation

- [ ] **Write README.md** — Create a comprehensive README with: package description and purpose, installation instructions (`npm install stream-tokens`), quick start example (sentence aggregation from an OpenAI stream), API reference for all public functions (`aggregate`, `sentences`, `words`, `lines`, `paragraphs`, `jsonObjects`, `createAggregator`, `fromOpenAI`, `fromAnthropic`), type reference (`AggregatedChunk`, `AggregationUnit`, `AggregatorOptions`, `BoundaryResult`), configuration reference (all options with defaults), examples for each aggregation unit, provider adapter usage, Transform stream usage, integration examples with `voice-turn`, `stream-validate`, and `ai-terminal-md`, performance characteristics, and limitations. | Status: not_done

- [ ] **Add JSDoc comments to all public exports** — Add JSDoc documentation comments to every public function, type, and interface exported from `src/index.ts`. Include parameter descriptions, return type descriptions, usage examples in `@example` tags, and `@see` references to related functions. | Status: not_done

- [ ] **Verify `package.json` metadata** — Ensure `package.json` has complete metadata: `name`, `version` (bump to appropriate version), `description`, `main` (`dist/index.js`), `types` (`dist/index.d.ts`), `files` (`["dist"]`), `keywords` (add relevant keywords: `stream`, `tokens`, `llm`, `aggregation`, `sentence`, `word`, `json`, `streaming`, `async-iterable`, `backpressure`), `author`, `license` (`MIT`), `engines` (`>=18`), `publishConfig`. | Status: not_done

---

## Phase 16: Build, Lint, and CI Verification

- [ ] **Verify TypeScript compilation** — Run `npm run build` (`tsc`) and ensure zero compilation errors. Verify that `dist/` output contains `.js`, `.d.ts`, and `.d.ts.map` files for all source modules. Verify the `dist/index.js` exports all public symbols. | Status: not_done

- [ ] **Configure and run ESLint** — Ensure ESLint is configured (create `.eslintrc` or `eslint.config` if not present) with TypeScript support. Run `npm run lint` and fix any issues. Verify zero lint errors. | Status: not_done

- [ ] **Run full test suite** — Run `npm run test` (`vitest run`) and verify all tests pass. Verify test coverage is adequate across all modules. | Status: not_done

- [ ] **Version bump** — Bump the version in `package.json` per semver. Since this is the initial implementation, set to `1.0.0` (or `0.1.0` if releasing as pre-1.0). | Status: not_done

---

## Phase 17: Publishing

- [ ] **Final review** — Review the complete codebase: all types match the spec, all aggregation units are implemented and tested, all options are supported, all edge cases are handled, README is accurate, JSDoc is complete. Run `npm run build && npm run lint && npm run test` one final time. | Status: not_done

- [ ] **Publish to npm** — Follow the monorepo workflow: merge PR to master, pull latest, `cd stream-tokens`, `npm publish`. The `prepublishOnly` script runs `npm run build` automatically. | Status: not_done
