import { expect, test } from "bun:test";
import { loadPlugins } from "../lib/plugins.ts";

type PluginConfig = Parameters<typeof loadPlugins>[0];

function pluginConfig(enabledPlugins: string[]): PluginConfig {
  return {
    getEnabledPlugins() {
      return enabledPlugins;
    },
  };
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
  const plugins = await loadPlugins(
    pluginConfig(["voice", "browser", "reaction-roles", "socials"])
  );
  expect(plugins.map((p) => p.name)).toEqual([
    "voice",
    "browser",
    "reaction-roles",
    "socials",
  ]);
});
