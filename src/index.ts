export type { AggregationUnit, AggregatedChunk, ChunkMetadata, BoundaryResult, AggregatorOptions } from './types';
export { aggregate } from './aggregate';

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
