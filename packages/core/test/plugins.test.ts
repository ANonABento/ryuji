import { expect, test } from "bun:test";
import { loadPlugins } from "../lib/plugins.ts";
import type { ConfigManager } from "../lib/config.ts";

function pluginConfig(enabledPlugins: string[]): ConfigManager {
  return {
    getEnabledPlugins() {
      return enabledPlugins;
    },
  } as Pick<ConfigManager, "getEnabledPlugins"> as ConfigManager;
}

test("loadPlugins returns empty array when no plugins enabled", async () => {
  const plugins = await loadPlugins(pluginConfig([]));
  expect(plugins).toEqual([]);
});

test("loadPlugins skips unknown plugin names", async () => {
  const plugins = await loadPlugins(pluginConfig(["nonexistent"]));
  expect(plugins).toEqual([]);
});

test("loadPlugins loads real workspace plugins", async () => {
  const plugins = await loadPlugins(pluginConfig(["voice", "browser", "socials"]));
  expect(plugins.map((p) => p.name)).toEqual(["voice", "browser", "socials"]);
});
