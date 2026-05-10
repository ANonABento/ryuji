import { describe, expect, test } from "bun:test";
import type { PluginContext } from "@choomfie/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tutorPlugin from "../../../plugins/tutor/index.ts";
import { getAllLessons, getUnits } from "../../../plugins/tutor/core/lesson-engine.ts";
import { chineseLessons, chineseUnits } from "../../../plugins/tutor/modules/chinese/lessons/index.ts";
import { frenchLessons, frenchUnits } from "../../../plugins/tutor/modules/french/lessons/index.ts";
import { japaneseLessons, japaneseUnits } from "../../../plugins/tutor/modules/japanese/lessons/index.ts";
import { spanishLessons, spanishUnits } from "../../../plugins/tutor/modules/spanish/lessons/index.ts";

const testConfig: PluginContext["config"] = {
  getConfig: () => ({}),
  getEnabledPlugins: () => [],
  getVoiceConfig: () => ({ stt: "none", tts: "none" }),
  getSocialsConfig: () => undefined,
};

describe("Tutor plugin startup", () => {
  test("registers structured lessons for every lesson-bearing module", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tutor-startup-"));
    const ctx: PluginContext = {
      DATA_DIR: dir,
      config: testConfig,
    };

    try {
      await tutorPlugin.init!(ctx);

      const expected = [
        ["japanese", japaneseLessons.length, japaneseUnits.length],
        ["chinese", chineseLessons.length, chineseUnits.length],
        ["french", frenchLessons.length, frenchUnits.length],
        ["spanish", spanishLessons.length, spanishUnits.length],
      ] as const;

      for (const [module, lessonCount, unitCount] of expected) {
        expect(getAllLessons(module)).toHaveLength(lessonCount);
        expect(getUnits(module)).toHaveLength(unitCount);
      }
    } finally {
      await tutorPlugin.destroy?.();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
