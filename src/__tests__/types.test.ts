import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  AggregationUnit,
  AggregatedChunk,
  AggregatorOptions,
  BoundaryResult,
  ChunkMetadata,
} from '../types';

describe('Type definitions', () => {
  it('AggregatedChunk requires content, unit, index, partial', () => {
    const chunk: AggregatedChunk = {
      content: 'hello',
      unit: 'word',
      index: 0,
      partial: false,
    };
    expectTypeOf(chunk.content).toBeString();
    expectTypeOf(chunk.unit).toMatchTypeOf<AggregationUnit>();
    expectTypeOf(chunk.index).toBeNumber();
    expectTypeOf(chunk.partial).toBeBoolean();
  });

  it('AggregatedChunk metadata is optional', () => {
    const chunk: AggregatedChunk = { content: 'x', unit: 'line', index: 0, partial: false };
    expectTypeOf(chunk.metadata).toMatchTypeOf<ChunkMetadata | undefined>();
  });

  it('AggregatorOptions all-optional', () => {
    const opts: AggregatorOptions = {};
    expectTypeOf(opts).toMatchTypeOf<AggregatorOptions>();
  });

  it('AggregationUnit covers all 8 values', () => {
    const units: AggregationUnit[] = [
      'word',
      'sentence',
      'paragraph',
      'line',
      'json',
      'code-block',
      'markdown-section',
      'custom',
    ];
    expectTypeOf(units[0]).toMatchTypeOf<AggregationUnit>();
    expect(units).toHaveLength(8);
  });

  it('BoundaryResult has boundaryEnd and nextStart', () => {
    const result: BoundaryResult = { boundaryEnd: 5, nextStart: 6 };
    expectTypeOf(result.boundaryEnd).toBeNumber();
    expectTypeOf(result.nextStart).toBeNumber();
  });

  it('BoundaryResult metadata is optional', () => {
    const result: BoundaryResult = { boundaryEnd: 0, nextStart: 0 };
    expectTypeOf(result.metadata).toMatchTypeOf<ChunkMetadata | undefined>();
  });

  it('ChunkMetadata fields are all optional', () => {
    const meta: ChunkMetadata = {};
    expectTypeOf(meta.language).toMatchTypeOf<string | undefined>();
    expectTypeOf(meta.fenceLength).toMatchTypeOf<number | undefined>();
    expectTypeOf(meta.level).toMatchTypeOf<number | undefined>();
    expectTypeOf(meta.heading).toMatchTypeOf<string | undefined>();
    expectTypeOf(meta.depth).toMatchTypeOf<number | undefined>();
    expectTypeOf(meta.inString).toMatchTypeOf<boolean | undefined>();
    expectTypeOf(meta.type).toMatchTypeOf<string | undefined>();
  });
});
