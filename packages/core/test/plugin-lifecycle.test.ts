import { describe, expect, test } from "bun:test";
import type { Plugin } from "@choomfie/shared";
import {
  destroyPlugins,
  dispatchPluginMessage,
  initializePlugins,
} from "../lib/plugin-lifecycle.ts";
import { testPluginContext } from "./helpers/plugin-context.ts";

describe("plugin lifecycle", () => {
  test("runs init, onMessage, and destroy hooks in order", async () => {
    const calls: string[] = [];
    const plugin: Plugin = {
      name: "lifecycle-test",
      tools: [],
      async init(ctx) {
        expect(ctx.DATA_DIR).toBe(testPluginContext.DATA_DIR);
        calls.push("init");
      },
      async onMessage(message) {
        expect(message.content).toBe("synthetic message");
        calls.push("onMessage");
      },
      async destroy() {
        calls.push("destroy");
      },
    };

    await initializePlugins([plugin], testPluginContext as any);
    await dispatchPluginMessage(
      [plugin],
      { content: "synthetic message" } as any,
      testPluginContext as any,
    );
    await destroyPlugins([plugin]);

    expect(calls).toEqual(["init", "onMessage", "destroy"]);
  });

  test("continues lifecycle dispatch after a plugin hook throws", async () => {
    const calls: string[] = [];
    const plugins: Plugin[] = [
      {
        name: "throws",
        tools: [],
        async onMessage() {
          throw new Error("boom");
        },
      },
      {
        name: "survives",
        tools: [],
        async onMessage() {
          calls.push("survives");
        },
      },
    ];

    await dispatchPluginMessage(
      plugins,
      { content: "synthetic message" } as any,
      testPluginContext as any,
    );

    expect(calls).toEqual(["survives"]);
  });
});
