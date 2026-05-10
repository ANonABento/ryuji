import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export function createMessageGenerator(): {
  generator: AsyncGenerator<SDKUserMessage>;
  push: (msg: SDKUserMessage) => void;
  close: () => void;
} {
  const queue: SDKUserMessage[] = [];
  let resolve: (() => void) | null = null;
  let closed = false;

  async function* generator(): AsyncGenerator<SDKUserMessage> {
    while (!closed) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((next) => {
          resolve = next;
        });
        resolve = null;
      }
    }
  }

  return {
    generator: generator(),
    push(msg: SDKUserMessage) {
      queue.push(msg);
      resolve?.();
    },
    close() {
      closed = true;
      resolve?.();
    },
  };
}
