export type SseEvent = { event: string; data: unknown };

/**
 * Parses a `text/event-stream` response body. Used for the message-send
 * endpoint, which streams over POST (native EventSource only supports GET).
 */
export async function* readSse(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let event = "message";
      const dataLines: string[] = [];
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }

      if (dataLines.length > 0) {
        try {
          yield { event, data: JSON.parse(dataLines.join("\n")) };
        } catch {
          // ignore malformed frame
        }
      }

      boundary = buffer.indexOf("\n\n");
    }
  }
}
