#!/usr/bin/env bun
import type { Plugin, PluginContext } from "@choomfie/shared";

const PLUGINS = ["voice", "browser", "tutor", "socials"] as const;

const ctx: PluginContext = {
  DATA_DIR: "/tmp/choomfie-plugin-smoke",
  config: {
    getConfig: () => ({}),
    getEnabledPlugins: () => [...PLUGINS],
    getVoiceConfig: () => ({ stt: "mock", tts: "mock" }),
    getSocialsConfig: () => undefined,
  },
  mcp: {
    notification: () => {},
  },
};

const message = {
  author: { bot: false, id: "smoke-user", username: "smoke" },
  content: "plugin smoke test",
  reply: async () => {},
} as any;

for (const name of PLUGINS) {
  const mod = await import(`@choomfie/${name}`);
  const plugin = mod.default as Plugin;

  if (plugin.name !== name) {
    throw new Error(`${name}: expected plugin.name=${name}, got ${plugin.name}`);
  }
  if (!Array.isArray(plugin.tools)) {
    throw new Error(`${name}: plugin.tools must be an array`);
  }

  for (const tool of plugin.tools) {
    if (!tool.definition?.name || !tool.definition.description || !tool.definition.inputSchema) {
      throw new Error(`${name}: malformed tool definition`);
    }
    if (typeof tool.handler !== "function") {
      throw new Error(`${name}: ${tool.definition.name} handler is not a function`);
    }
  }

  await plugin.onMessage?.(message, ctx);
  console.log(`${name}: ok (${plugin.tools.length} tools)`);
}

console.log("plugin smoke test passed");
