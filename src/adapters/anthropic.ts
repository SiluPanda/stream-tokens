/**
 * Extract text chunks from an Anthropic streaming response.
 * Structurally typed — no import of Anthropic SDK required.
 */
export async function* fromAnthropic(
  stream: AsyncIterable<{ type: string; delta?: { type?: string; text?: string } }>
): AsyncIterable<string> {
  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta?.type === 'text_delta' &&
      event.delta.text
    ) {
      yield event.delta.text;
    }
  }
}
