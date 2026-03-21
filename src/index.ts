export type { AggregationUnit, AggregatedChunk, ChunkMetadata, BoundaryResult, AggregatorOptions } from './types';
export { aggregate } from './aggregate';
export { detectWordBoundary } from './units/word';
export { detectLineBoundary } from './units/line';
export { detectParagraphBoundary } from './units/paragraph';
export { detectJsonBoundary } from './units/json';
export { detectCodeBlockBoundary } from './units/code-block';
export { detectMarkdownSectionBoundary } from './units/markdown-section';
export { fromOpenAI } from './adapters/openai';
export { fromAnthropic } from './adapters/anthropic';

// Convenience shorthands
import { aggregate } from './aggregate';
import type { AggregatorOptions, AggregatedChunk } from './types';

export function sentences(stream: AsyncIterable<string> | ReadableStream<string>, options?: AggregatorOptions): AsyncIterable<AggregatedChunk> {
  return aggregate(stream, 'sentence', options);
}
export function words(stream: AsyncIterable<string> | ReadableStream<string>, options?: AggregatorOptions): AsyncIterable<AggregatedChunk> {
  return aggregate(stream, 'word', options);
}
export function lines(stream: AsyncIterable<string> | ReadableStream<string>, options?: AggregatorOptions): AsyncIterable<AggregatedChunk> {
  return aggregate(stream, 'line', options);
}
export function paragraphs(stream: AsyncIterable<string> | ReadableStream<string>, options?: AggregatorOptions): AsyncIterable<AggregatedChunk> {
  return aggregate(stream, 'paragraph', options);
}
export function jsonObjects(stream: AsyncIterable<string> | ReadableStream<string>, options?: AggregatorOptions): AsyncIterable<AggregatedChunk> {
  return aggregate(stream, 'json', options);
}
export function codeBlocks(stream: AsyncIterable<string> | ReadableStream<string>, options?: AggregatorOptions): AsyncIterable<AggregatedChunk> {
  return aggregate(stream, 'code-block', options);
}
export function markdownSections(stream: AsyncIterable<string> | ReadableStream<string>, options?: AggregatorOptions): AsyncIterable<AggregatedChunk> {
  return aggregate(stream, 'markdown-section', options);
}
