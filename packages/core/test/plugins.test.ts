import { expect, test } from "bun:test";
import { loadPlugins } from "../lib/plugins.ts";
import type { PluginProviderConfig } from "../lib/plugins.ts";

test("loadPlugins returns empty array when no plugins enabled", async () => {
  const config: PluginProviderConfig = {
    getEnabledPlugins() {
      return [];
    },
  };

  const plugins = await loadPlugins(config);
  expect(plugins).toEqual([]);
});

test("loadPlugins skips unknown plugin names", async () => {
  const config: PluginProviderConfig = {
    getEnabledPlugins() {
      return ["nonexistent"];
    },
  };

  const plugins = await loadPlugins(config);
  expect(plugins).toEqual([]);
});

test("loadPlugins loads real workspace plugins", async () => {
  const config: PluginProviderConfig = {
    getEnabledPlugins() {
      return ["automod", "voice", "browser", "socials"];
    },
  };

  const plugins = await loadPlugins(config);
  expect(plugins.map((p) => p.name)).toEqual([
    "automod",
    "voice",
    "browser",
    "socials",
  ]);
});
