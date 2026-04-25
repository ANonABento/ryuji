/**
 * Tests for lesson button option rendering.
 */
import { describe, expect, test } from "bun:test";
import {
  buildAnswerCustomId,
  buildButtonOptions,
  buildExerciseButtons,
  buildModePickerComponents,
  getSessionExercisePrompt,
  isTypingExercise,
  type ActiveLessonSession,
} from "../../../plugins/tutor/lesson-interactions.ts";
import type { ChartExercise, Exercise, Lesson } from "../../../plugins/tutor/core/lesson-types.ts";

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
    exerciseSet: lesson.exercises,
    selectedMode: null,
    answerOptionsByExercise: new Map(),
    chartProgressByExercise: new Map(),
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
    expect(buildAnswerCustomId("3.1", 4, "abc123", 2)).toBe(
      "lesson:answer:3.1:4:abc123:2"
    );
  });

  test("all non-button exercise types are handled as typed answers", () => {
    expect(isTypingExercise({ type: "production", prompt: "p", answer: "a" })).toBe(true);
    expect(isTypingExercise({ type: "cloze", prompt: "p", answer: "a" })).toBe(true);
    expect(isTypingExercise({ type: "error_correction", prompt: "p", answer: "a" })).toBe(true);
    expect(isTypingExercise({ type: "sentence_build", prompt: "p", answer: "a" })).toBe(true);
    expect(
      isTypingExercise({ type: "multiple_choice", prompt: "p", answer: "a", distractors: ["b"] })
    ).toBe(false);
  });

  test("mode picker custom IDs stay short and parseable", () => {
    const modeLesson: Lesson = {
      ...lesson,
      exercises: [
        { type: "recognition", prompt: "p", answer: "a", distractors: ["b"] },
        { type: "production", prompt: "p", answer: "a" },
        { type: "matching", prompt: "p", answer: "a", distractors: ["b"] },
      ],
    };

    const rows = buildModePickerComponents(modeLesson);
    const components = rows[0].toJSON().components as ButtonComponentJson[];

    expect(components.map((component) => component.custom_id)).toEqual([
      "lesson:mode:test.1:mixed",
      "lesson:mode:test.1:recognition",
      "lesson:mode:test.1:production",
      "lesson:mode:test.1:matching",
    ]);
    expect(components.every((component) => component.custom_id.length <= 100)).toBe(true);
  });

  test("structured chart prompts advance the highlighted blank", () => {
    const exercise: ChartExercise = {
      type: "chart",
      prompt: "",
      answer: "え",
      distractors: ["お", "か", "こ"],
      grid: [["あ", "い", "う", null, "お"], ["か", "き", null, "け", "こ"]],
      blanks: [
        { row: 0, col: 3, answer: "え", reading: "e" },
        { row: 1, col: 2, answer: "く", reading: "ku" },
      ],
      rowLabels: ["∅-", "k-"],
      colLabels: ["a", "i", "u", "e", "o"],
    };
    const chartLesson = { ...lesson, exercises: [exercise] };
    const session: ActiveLessonSession = {
      ...makeSession(),
      lesson: chartLesson,
      exerciseSet: chartLesson.exercises,
    };

    const initialPrompt = getSessionExercisePrompt(session, 0, exercise);
    expect(initialPrompt).toContain("Fill blank 1/2");
    expect(initialPrompt).toContain("??");

    buildExerciseButtons(exercise, lesson.id, 0, session);
    const storedOptions = [...session.answerOptionsByExercise.get("0:0")!.values()];
    expect(storedOptions).toContain("え");
    expect(storedOptions).not.toContain("く");
    expect(
      buttonComponents(session, exercise).every((component) => component.custom_id.endsWith(":0"))
    ).toBe(true);

    session.chartProgressByExercise.get(0)!.filledAnswers[0] = "え";
    session.chartProgressByExercise.get(0)!.currentBlankIndex = 1;

    const nextPrompt = getSessionExercisePrompt(session, 0, exercise);
    expect(nextPrompt).toContain("Fill blank 2/2");
    expect(nextPrompt).toContain("え");
    expect(
      buttonComponents(session, exercise).every((component) => component.custom_id.endsWith(":1"))
    ).toBe(true);
  });
});
