/**
 * Regression tests for the Japanese lesson catalog shape.
 */
import { describe, expect, test } from "bun:test";
import { japaneseLessons, japaneseUnits } from "../../../plugins/tutor/modules/japanese/lessons/index.ts";
import {
  getActiveChartBlank,
  getExerciseAnswer,
  isButtonExercise,
} from "../../../plugins/tutor/core/lesson-types.ts";

const EXPECTED_JAPANESE_UNIT_NAMES = [
  "Hiragana",
  "Katakana",
  "First Words & Phrases",
  "Basic Grammar",
];

describe("Japanese lesson catalog", () => {
  test("registers the four progress units from the same lesson registry", () => {
    expect(japaneseUnits.map((unit) => unit.name)).toEqual(EXPECTED_JAPANESE_UNIT_NAMES);

    const lessonIds = new Set(japaneseLessons.map((lesson) => lesson.id));
    const unitLessonIds = new Set(japaneseUnits.flatMap((unit) => unit.lessonIds));
    const orphanLessonIds = [...lessonIds].filter((lessonId) => !unitLessonIds.has(lessonId));

    expect(orphanLessonIds).toEqual([]);
  });

  test("has no duplicate lesson IDs", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const lesson of japaneseLessons) {
      if (seen.has(lesson.id)) duplicates.push(lesson.id);
      seen.add(lesson.id);
    }

    expect(duplicates).toEqual([]);
  });

  test("all prerequisites and unit lesson references resolve", () => {
    const lessonIds = new Set(japaneseLessons.map((lesson) => lesson.id));
    const missingPrereqs: string[] = [];
    const missingUnitRefs: string[] = [];
    const unitRefs = new Map<string, string[]>();

    for (const lesson of japaneseLessons) {
      for (const prerequisite of lesson.prerequisites) {
        if (!lessonIds.has(prerequisite)) {
          missingPrereqs.push(`${lesson.id} -> ${prerequisite}`);
        }
      }
    }

    for (const unit of japaneseUnits) {
      for (const lessonId of unit.lessonIds) {
        unitRefs.set(lessonId, [...(unitRefs.get(lessonId) ?? []), unit.id]);
        if (!lessonIds.has(lessonId)) {
          missingUnitRefs.push(`${unit.id} -> ${lessonId}`);
        }
      }
    }

    const missingFromUnits = [...lessonIds].filter((lessonId) => !unitRefs.has(lessonId));
    const duplicateUnitRefs = [...unitRefs.entries()]
      .filter(([, unitIds]) => unitIds.length > 1)
      .map(([lessonId, unitIds]) => `${lessonId} -> ${unitIds.join(", ")}`);

    expect(missingPrereqs).toEqual([]);
    expect(missingUnitRefs).toEqual([]);
    expect(missingFromUnits).toEqual([]);
    expect(duplicateUnitRefs).toEqual([]);
  });

  test("every lesson has valid exercises", () => {
    const emptyLessons: string[] = [];
    const emptyAnswers: string[] = [];
    const degenerateButtons: string[] = [];
    const duplicateButtonOptions: string[] = [];
    const selfDistractors: string[] = [];
    const impossibleMastery: string[] = [];
    const missingChartData: string[] = [];
    const invalidChartBlanks: string[] = [];
    const missingChartOptions: string[] = [];

    for (const lesson of japaneseLessons) {
      if (lesson.exercises.length === 0) emptyLessons.push(lesson.id);
      if (Math.ceil(0.8 * lesson.exercises.length) > lesson.exercises.length) {
        impossibleMastery.push(lesson.id);
      }

      for (const [index, exercise] of lesson.exercises.entries()) {
        const ref = `${lesson.id}#${index}`;
        if (exercise.answer.trim().length === 0) emptyAnswers.push(ref);
        if (isButtonExercise(exercise.type) && (exercise.distractors?.length ?? 0) === 0) {
          degenerateButtons.push(ref);
        }
        if (isButtonExercise(exercise.type)) {
          const options = [getExerciseAnswer(exercise), ...(exercise.distractors ?? [])];
          if (new Set(options).size !== options.length) duplicateButtonOptions.push(ref);
          if ((exercise.distractors ?? []).includes(getExerciseAnswer(exercise))) {
            selfDistractors.push(ref);
          }
        }
        if (exercise.type === "chart") {
          if (!exercise.chart) {
            missingChartData.push(ref);
            continue;
          }

          const activeBlank = getActiveChartBlank(exercise);
          if (!activeBlank || activeBlank.answer.trim().length === 0) {
            invalidChartBlanks.push(ref);
          } else if (![getExerciseAnswer(exercise), ...(exercise.distractors ?? [])].includes(activeBlank.answer)) {
            missingChartOptions.push(ref);
          }

          for (const blank of exercise.chart.blanks) {
            const row = exercise.chart.grid[blank.row];
            if (
              !row ||
              blank.col < 0 ||
              blank.col >= row.length ||
              row[blank.col] !== null ||
              blank.answer.trim().length === 0
            ) {
              invalidChartBlanks.push(ref);
              break;
            }
          }
        }
      }
    }

    expect(emptyLessons).toEqual([]);
    expect(emptyAnswers).toEqual([]);
    expect(degenerateButtons).toEqual([]);
    expect(duplicateButtonOptions).toEqual([]);
    expect(selfDistractors).toEqual([]);
    expect(impossibleMastery).toEqual([]);
    expect(missingChartData).toEqual([]);
    expect(invalidChartBlanks).toEqual([]);
    expect(missingChartOptions).toEqual([]);
  });

  test("all lessons are reachable from root lessons through prerequisites", () => {
    const reachable = new Set(
      japaneseLessons
        .filter((lesson) => lesson.prerequisites.length === 0)
        .map((lesson) => lesson.id)
    );

    let changed = true;
    while (changed) {
      changed = false;
      for (const lesson of japaneseLessons) {
        if (reachable.has(lesson.id)) continue;
        if (lesson.prerequisites.every((prerequisite) => reachable.has(prerequisite))) {
          reachable.add(lesson.id);
          changed = true;
        }
      }
    }

    const unreachable = japaneseLessons
      .map((lesson) => lesson.id)
      .filter((lessonId) => !reachable.has(lessonId));

    expect(unreachable).toEqual([]);
  });
});
