/**
 * Regression tests for the Japanese lesson catalog shape.
 */
import { describe, expect, test } from "bun:test";
import { japaneseLessons, japaneseUnits } from "../../../plugins/tutor/modules/japanese/lessons/index.ts";
import { isButtonExercise } from "../../../plugins/tutor/core/lesson-types.ts";

describe("Japanese lesson catalog", () => {
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

    for (const lesson of japaneseLessons) {
      for (const prerequisite of lesson.prerequisites) {
        if (!lessonIds.has(prerequisite)) {
          missingPrereqs.push(`${lesson.id} -> ${prerequisite}`);
        }
      }
    }

    for (const unit of japaneseUnits) {
      for (const lessonId of unit.lessonIds) {
        if (!lessonIds.has(lessonId)) {
          missingUnitRefs.push(`${unit.id} -> ${lessonId}`);
        }
      }
    }

    expect(missingPrereqs).toEqual([]);
    expect(missingUnitRefs).toEqual([]);
  });

  test("every lesson has valid exercises", () => {
    const emptyLessons: string[] = [];
    const emptyAnswers: string[] = [];
    const degenerateButtons: string[] = [];
    const impossibleMastery: string[] = [];

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
      }
    }

    expect(emptyLessons).toEqual([]);
    expect(emptyAnswers).toEqual([]);
    expect(degenerateButtons).toEqual([]);
    expect(impossibleMastery).toEqual([]);
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
