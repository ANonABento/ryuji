import { afterEach, expect, test } from "bun:test";
import { McpProxy } from "../lib/mcp-proxy.ts";

const originalSend = (process as any).send;

afterEach(() => {
  (process as any).send = originalSend;
});

test("McpProxy forwards worker notifications without modifying method or params", () => {
  const sent: unknown[] = [];
  (process as any).send = (msg: unknown) => {
    sent.push(msg);
    return true;
  };

  const proxy = new McpProxy();
  proxy.notification({
    method: "notifications/claude/channel",
    params: {
      content: "hello from dm",
      meta: { chat_id: "dm-1", is_dm: "true" },
    },
  });

  expect(sent).toEqual([
    {
      type: "notification",
      method: "notifications/claude/channel",
      params: {
        content: "hello from dm",
        meta: { chat_id: "dm-1", is_dm: "true" },
      },
    },
  ]);
});

test("McpProxy relays permission requests to registered handlers", async () => {
  const proxy = new McpProxy();
  const handled: unknown[] = [];

  proxy.setNotificationHandler({}, async (msg) => {
    handled.push(msg.params);
  });

  await proxy.handlePermissionRequest({
    type: "permission_request",
    method: "notifications/claude/channel/permission_request",
    params: { request_id: "abcde", behavior: "allow" },
  });

  expect(handled).toEqual([{ request_id: "abcde", behavior: "allow" }]);
});
