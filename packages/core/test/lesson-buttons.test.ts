/**
 * Tests for lesson button option rendering.
 */
import { describe, expect, test } from "bun:test";
import {
  buildAnswerCustomId,
  buildButtonOptions,
  buildExerciseButtons,
  type ActiveSession,
} from "../../../plugins/tutor/lesson-interactions.ts";
import type { Exercise, Lesson } from "../../../plugins/tutor/core/lesson-types.ts";

const lesson: Lesson = {
  id: "test.1",
  unit: "test",
  unitIndex: 1,
  title: "Test lesson",
  prerequisites: [],
  introduction: { text: "intro" },
  exercises: [],
};

function makeSession(): ActiveSession {
  return {
    userId: "u1",
    module: "japanese",
    lessonId: lesson.id,
    exerciseIndex: 0,
    lesson,
    answerOptions: new Map(),
  };
}

describe("lesson button rendering", () => {
  test("button options always include the correct answer when distractors exceed Discord limits", () => {
    const exercise: Exercise = {
      type: "multiple_choice",
      prompt: "Pick one",
      answer: "correct",
      distractors: ["wrong-1", "wrong-2", "wrong-3", "wrong-4", "wrong-5", "wrong-6"],
    };

    for (let i = 0; i < 50; i++) {
      const options = buildButtonOptions(exercise);
      expect(options).toHaveLength(5);
      expect(options).toContain(exercise.answer);
    }
  });

  test("answer custom IDs use short tokens, not raw answer text", () => {
    const exercise: Exercise = {
      type: "multiple_choice",
      prompt: "Pick one",
      answer: "answer:with:colons",
      distractors: ["a very long distractor label that should remain only in session memory"],
    };
    const session = makeSession();

    const rows = buildExerciseButtons(exercise, lesson.id, 0, session);
    const components = (rows[0] as any).toJSON().components;

    expect(components).toHaveLength(2);
    for (const component of components) {
      expect(component.custom_id.length).toBeLessThanOrEqual(100);
      expect(component.custom_id).not.toContain(exercise.answer);
      expect(component.custom_id).not.toContain(exercise.distractors![0]);
    }

    const storedOptions = [...session.answerOptions.get(0)!.values()];
    expect(storedOptions).toContain(exercise.answer);
    expect(storedOptions).toContain(exercise.distractors![0]);
  });

  test("overlong button labels are truncated while full answers stay in session state", () => {
    const longAnswer = "this answer is intentionally longer than the Discord button label limit ".repeat(2);
    const exercise: Exercise = {
      type: "multiple_choice",
      prompt: "Pick one",
      answer: longAnswer,
      distractors: ["short"],
    };
    const session = makeSession();

    const rows = buildExerciseButtons(exercise, lesson.id, 0, session);
    const components = (rows[0] as any).toJSON().components;

    expect(components.every((component: any) => component.label.length <= 80)).toBe(true);
    expect([...session.answerOptions.get(0)!.values()]).toContain(longAnswer);
  });

  test("rerendering the same exercise keeps token-to-answer mapping stable", () => {
    const exercise: Exercise = {
      type: "multiple_choice",
      prompt: "Pick one",
      answer: "correct",
      distractors: ["wrong-1", "wrong-2", "wrong-3"],
    };
    const session = makeSession();

    buildExerciseButtons(exercise, lesson.id, 0, session);
    const firstMapping = [...session.answerOptions.get(0)!];

    buildExerciseButtons(exercise, lesson.id, 0, session);
    const secondMapping = [...session.answerOptions.get(0)!];

    expect(secondMapping).toEqual(firstMapping);
  });

  test("buildAnswerCustomId preserves the stable lesson answer shape", () => {
    expect(buildAnswerCustomId("3.1", 4, "abc123")).toBe("lesson:answer:3.1:4:abc123");
  });
});
