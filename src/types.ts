export type AggregationUnit =
  | 'word'
  | 'sentence'
  | 'paragraph'
  | 'line'
  | 'json'
  | 'code-block'
  | 'markdown-section'
  | 'custom';

export interface ChunkMetadata {
  language?: string;      // for code-block: the fence language tag
  fenceLength?: number;   // for code-block: backtick count
  level?: number;         // for markdown-section: heading level (1-6)
  heading?: string;       // for markdown-section: heading text
  depth?: number;         // for json: nesting depth when emitted
  inString?: boolean;     // for json: was inside string when boundary found
  type?: string;          // for json: 'object' | 'array'
}

export interface AggregatedChunk {
  content: string;
  unit: AggregationUnit;
  index: number;          // zero-based, increments per chunk
  partial: boolean;       // true if emitted before natural boundary (flush)
  metadata?: ChunkMetadata;
}

export interface BoundaryResult {
  boundaryEnd: number;    // exclusive end index of the completed unit in buffer
  nextStart: number;      // start index for next unit (may skip whitespace)
  contentStart?: number;  // optional: start index of actual content (skips preamble)
  metadata?: ChunkMetadata;
}

export interface AggregatorOptions {
  flush?: 'emit' | 'discard' | 'callback';
  onFlush?: (content: string, unit: AggregationUnit) => void;
  maxBufferSize?: number;  // bytes, default 10_000_000

  // sentence options
  abbreviations?: string[];   // extra abbreviations beyond built-in list
  ellipsisIsSentenceEnd?: boolean; // treat "..." as sentence end, default true
  minLength?: number;           // minimum sentence length before emitting, default 0

  // word options
  trimWhitespace?: boolean;   // default true
  includeWhitespace?: boolean; // include trailing whitespace in word content, default false
  preservePunctuation?: boolean; // keep punctuation attached to words, default true

  // line options
  includeNewline?: boolean;     // include \n in emitted lines, default false
  skipEmpty?: boolean;          // skip empty lines, default false

  // paragraph options
  minParagraphLength?: number; // default 1

  // json options
  allowMultiple?: boolean;    // emit multiple JSON values, default true

  // code-block options
  includeDelimiters?: boolean; // include ``` lines in content, default true

  // markdown-section options
  minLevel?: number;          // minimum heading level to split on, default 1
  maxLevel?: number;          // maximum heading level, default 6

  // custom options
  detect?: (buffer: string) => BoundaryResult | null;
}
