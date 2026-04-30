import { describe, expect, test } from "bun:test";
import { getAllModuleTools, getModule, listModules } from "../../../plugins/tutor/modules/index.ts";
import { japaneseModule } from "../../../plugins/tutor/modules/japanese/index.ts";

describe("Japanese tutor module", () => {
  test("is registered as a tutor module", () => {
    expect(getModule("japanese")).toBe(japaneseModule);
    expect(listModules().map((module) => module.name)).toContain("japanese");
  });

  test("exposes N5 metadata and tutor prompt", () => {
    expect(japaneseModule.defaultLevel).toBe("N5");
    expect(japaneseModule.levels).toContain("N5");

    const prompt = japaneseModule.buildTutorPrompt!("N5");
    expect(prompt).toContain("Japanese language tutor");
    expect(prompt).toContain("furigana");
    expect(prompt).toContain("hiragana");
  });

  test("generates basic quiz types", () => {
    for (const quizType of japaneseModule.quizTypes ?? []) {
      const quiz = japaneseModule.generateQuiz!("N5", quizType);
      expect(quiz.question.length).toBeGreaterThan(0);
      expect(quiz.options.length).toBeGreaterThanOrEqual(2);
      expect(quiz.correctIndex).toBeGreaterThanOrEqual(0);
      expect(quiz.correctIndex).toBeLessThan(quiz.options.length);
    }
  });

  test("registers Japanese-specific tools", () => {
    const toolNames = getAllModuleTools().map((tool) => tool.definition.name);

    expect(toolNames).toContain("convert_kana");
    expect(toolNames).toContain("kanji_stroke_info");
  });
});
