import { expect, test } from "bun:test";
import { loadPlugins } from "../lib/plugins.ts";

test("loadPlugins returns empty array when no plugins enabled", async () => {
  const config = {
    getEnabledPlugins() {
      return [];
    },
  };

  const plugins = await loadPlugins(config as any);
  expect(plugins).toEqual([]);
});

test("loadPlugins skips unknown plugin names", async () => {
  const config = {
    getEnabledPlugins() {
      return ["nonexistent"];
    },
  };

  const plugins = await loadPlugins(config as any);
  expect(plugins).toEqual([]);
});

test("loadPlugins loads real workspace plugins", async () => {
  const config = {
    getEnabledPlugins() {
      return ["voice", "browser"];
    },
  };

  const plugins = await loadPlugins(config as any);
  expect(plugins.map((p) => p.name)).toEqual(["voice", "browser"]);
});
