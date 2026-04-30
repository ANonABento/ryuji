/**
 * Regression test — verifies no plugin imports from another plugin or from core's lib/.
 */
import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// plugins/ directory — each plugin is a workspace package
const PLUGINS_DIR = join(import.meta.dir, "../../../..", "plugins");
const PLUGIN_NAMES = ["automod", "voice", "browser", "tutor", "socials"];

/** Recursively get all .ts files in a directory */
function getTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...getTsFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("import validation", () => {
  test("no plugin imports from another plugin package", () => {
    const violations: string[] = [];

    for (const pluginName of PLUGIN_NAMES) {
      const pluginDir = join(PLUGINS_DIR, pluginName);
      const files = getTsFiles(pluginDir);

      for (const file of files) {
        const content = readFileSync(file, "utf-8");
        for (const otherPlugin of PLUGIN_NAMES) {
          if (otherPlugin === pluginName) continue;
          // Check both old plugins/ path and new @choomfie/ cross-import
          const patterns = [
            new RegExp(`from\\s+["'].*plugins/${otherPlugin}/`),
            new RegExp(`from\\s+["']@choomfie/${otherPlugin}`),
          ];
          for (const pattern of patterns) {
            if (pattern.test(content)) {
              const relative = file.replace(PLUGINS_DIR + "/", "");
              violations.push(
                `${relative} imports from ${otherPlugin}`,
              );
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("no plugin imports from core lib/ via relative paths", () => {
    const violations: string[] = [];

    for (const pluginName of PLUGIN_NAMES) {
      const pluginDir = join(PLUGINS_DIR, pluginName);
      const files = getTsFiles(pluginDir);

      for (const file of files) {
        const content = readFileSync(file, "utf-8");
        // After migration, no plugin should have relative imports to lib/
        const libImports = content.match(
          /from\s+["']\.\.\/[^"']*lib\/[^"']+["']/g,
        );
        if (libImports) {
          const relative = file.replace(PLUGINS_DIR + "/", "");
          for (const imp of libImports) {
            violations.push(`${relative}: ${imp}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
