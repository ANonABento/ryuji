/**
 * Tests for lesson button option rendering.
 */
import { describe, expect, test } from "bun:test";
import {
  buildAnswerCustomId,
  buildChartCustomId,
  buildButtonOptions,
  buildExerciseButtons,
  buildModeCustomId,
  expandExercisesForSession,
  setSessionMode,
  type ActiveLessonSession,
} from "../../../plugins/tutor/lesson-interactions.ts";
import type { Exercise, Lesson } from "../../../plugins/tutor/core/lesson-types.ts";

type ButtonComponentJson = {
  custom_id: string;
  label: string;
};

const lesson: Lesson = {
  id: "test.1",
  unit: "test",
  unitIndex: 1,
  title: "Test lesson",
  prerequisites: [],
  introduction: { text: "intro" },
  exercises: [],
};

function makeSession(): ActiveLessonSession {
  return {
    userId: "u1",
    module: "japanese",
    lessonId: lesson.id,
    exerciseIndex: 0,
    lesson,
    exercises: lesson.exercises,
    answerOptionsByExercise: new Map(),
  };
}

function buttonComponents(session: ActiveLessonSession, exercise: Exercise): ButtonComponentJson[] {
  const rows = buildExerciseButtons(exercise, session.lessonId, session.exerciseIndex, session);
  return rows[0].toJSON().components as ButtonComponentJson[];
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

    const components = buttonComponents(session, exercise);

    expect(components).toHaveLength(2);
    for (const component of components) {
      expect(component.custom_id.length).toBeLessThanOrEqual(100);
      expect(component.custom_id).not.toContain(exercise.answer);
      expect(component.custom_id).not.toContain(exercise.distractors![0]);
    }

    const storedOptions = [...session.answerOptionsByExercise.get(0)!.values()];
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

    const components = buttonComponents(session, exercise);

    expect(components.every((component) => component.label.length <= 80)).toBe(true);
    expect([...session.answerOptionsByExercise.get(0)!.values()]).toContain(longAnswer);
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
    const firstMapping = [...session.answerOptionsByExercise.get(0)!];

    buildExerciseButtons(exercise, lesson.id, 0, session);
    const secondMapping = [...session.answerOptionsByExercise.get(0)!];

    expect(secondMapping).toEqual(firstMapping);
  });

  test("buildAnswerCustomId preserves the stable lesson answer shape", () => {
    expect(buildAnswerCustomId("3.1", 4, "abc123")).toBe("lesson:answer:3.1:4:abc123");
  });

  test("mode and chart custom IDs are stable and short", () => {
    expect(buildModeCustomId("3.1", "matching")).toBe("lesson:mode:3.1:matching");
    expect(buildChartCustomId("1.3", 12, 2, "0")).toBe("lesson:chart:1.3:12:2:0");
    expect(buildChartCustomId("1.3", 12, 2, "0").length).toBeLessThanOrEqual(100);
  });

  test("chart exercises expand into one scored runtime exercise per blank", () => {
    const chart: Exercise = {
      type: "chart",
      prompt: "chart",
      answer: "あ",
      distractors: ["い", "う"],
      chart: {
        grid: [[null, "い"], ["う", null]],
        blanks: [
          { row: 0, col: 0, answer: "あ", reading: "a" },
          { row: 1, col: 1, answer: "え", reading: "e" },
        ],
      },
    };

    const expanded = expandExercisesForSession([chart]);

    expect(expanded).toHaveLength(2);
    expect(expanded.map((exercise) => exercise.answer)).toEqual(["あ", "え"]);
    expect(expanded.map((exercise) => exercise.chartBlankIndex)).toEqual([0, 1]);
    expect(expanded[0].prompt).toContain("??");
  });

  test("selecting a mode replaces the session exercise list", () => {
    const session = makeSession();
    session.lesson = {
      ...lesson,
      contentSets: [
        {
          items: [
            { term: "あ", reading: "a", meaning: "a (vowel)" },
            { term: "い", reading: "i", meaning: "i (vowel)" },
          ],
        },
      ],
      selectableModes: ["recognition", "production", "matching", "mixed"],
    };
    session.exercises = [];

    setSessionMode(session, "production");

    expect(session.selectedMode).toBe("production");
    expect(session.exercises).toHaveLength(2);
    expect(session.exercises.every((exercise) => exercise.type === "production")).toBe(true);
  });
});
