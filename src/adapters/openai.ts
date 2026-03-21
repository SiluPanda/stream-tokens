/**
 * Extract text chunks from an OpenAI streaming response.
 * Structurally typed — no import of OpenAI SDK required.
 */
export async function* fromOpenAI(
  stream: AsyncIterable<{ choices: Array<{ delta: { content?: string | null } }> }>
): AsyncIterable<string> {
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text != null && text !== '') {
      yield text;
    }
  }
}
