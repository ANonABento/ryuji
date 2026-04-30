import { describe, expect, test } from "bun:test";
import { getAllModuleTools, getModule, listModules } from "../../../plugins/tutor/modules/index.ts";
import { spanishModule } from "../../../plugins/tutor/modules/spanish/index.ts";
import { spanishToIpa } from "../../../plugins/tutor/modules/spanish/pronunciation.ts";

describe("Spanish tutor module", () => {
  test("is registered as a tutor module", () => {
    expect(getModule("spanish")).toBe(spanishModule);
    expect(listModules().map((module) => module.name)).toContain("spanish");
  });

  test("exposes A1 level metadata and tutor prompt", () => {
    expect(spanishModule.defaultLevel).toBe("A1");
    expect(spanishModule.levels).toContain("B1");

    const prompt = spanishModule.buildTutorPrompt!("A1");
    expect(prompt).toContain("Spanish language tutor");
    expect(prompt).toContain("CEFR A1");
    expect(prompt).toContain("pronunciation");
  });

  test("generates basic quiz types", () => {
    for (const quizType of spanishModule.quizTypes ?? []) {
      const quiz = spanishModule.generateQuiz!("A1", quizType);
      expect(quiz.question.length).toBeGreaterThan(0);
      expect(quiz.options.length).toBeGreaterThanOrEqual(2);
      expect(quiz.correctIndex).toBeGreaterThanOrEqual(0);
      expect(quiz.correctIndex).toBeLessThan(quiz.options.length);
    }
  });

  test("registers Spanish-specific pronunciation tool", () => {
    const toolNames = getAllModuleTools().map((tool) => tool.definition.name);

    expect(toolNames).toContain("spanish_pronunciation");
  });

  test("generates practical IPA for basic words", () => {
    expect(spanishToIpa("hola")).toBe("ˈola");
    expect(spanishToIpa("gracias")).toBe("ˈɡɾasjas");
  });
});
