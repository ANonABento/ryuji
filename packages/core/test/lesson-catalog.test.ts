/**
 * Regression tests for lesson catalog shape.
 */
import { describe, expect, test } from "bun:test";
import { japaneseLessons, japaneseUnits } from "../../../plugins/tutor/modules/japanese/lessons/index.ts";
import {
  chineseHsk1VocabularyItems,
  chineseLessons,
  chineseUnits,
} from "../../../plugins/tutor/modules/chinese/lessons/index.ts";
import {
  frenchA1VocabularyItems,
  frenchLessons,
  frenchUnits,
} from "../../../plugins/tutor/modules/french/lessons/index.ts";
import { isButtonExercise } from "../../../plugins/tutor/core/lesson-types.ts";
import type { Lesson, Unit } from "../../../plugins/tutor/core/lesson-types.ts";

const EXPECTED_JAPANESE_UNIT_NAMES = [
  "Hiragana",
  "Katakana",
  "First Words & Phrases",
  "Basic Grammar",
] as const;

const EXPECTED_CHINESE_UNIT_NAMES = ["Tones", "Hanzi", "HSK 1 Vocabulary"] as const;
const EXPECTED_FRENCH_UNIT_NAMES = ["Pronunciation", "A1 Vocabulary", "First Conversations"] as const;

function expectRegisteredUnits(
  lessons: Lesson[],
  units: Unit[],
  expectedUnitNames: readonly string[]
): void {
  expect(units.map((unit) => unit.name)).toEqual(expectedUnitNames);

  const lessonIds = new Set(lessons.map((lesson) => lesson.id));
  const unitLessonIds = new Set(units.flatMap((unit) => unit.lessonIds));
  const orphanLessonIds = [...lessonIds].filter((lessonId) => !unitLessonIds.has(lessonId));

  expect(orphanLessonIds).toEqual([]);
}

function expectUniqueLessonIds(lessons: Lesson[]): void {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const lesson of lessons) {
    if (seen.has(lesson.id)) duplicates.push(lesson.id);
    seen.add(lesson.id);
  }

  expect(duplicates).toEqual([]);
}

function expectResolvedLessonReferences(lessons: Lesson[], units: Unit[]): void {
  const lessonIds = new Set(lessons.map((lesson) => lesson.id));
  const missingPrereqs: string[] = [];
  const missingUnitRefs: string[] = [];
  const unitRefs = new Map<string, string[]>();

  for (const lesson of lessons) {
    for (const prerequisite of lesson.prerequisites) {
      if (!lessonIds.has(prerequisite)) {
        missingPrereqs.push(`${lesson.id} -> ${prerequisite}`);
      }
    }
  }

  for (const unit of units) {
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
}

function expectValidLessonExercises(lessons: Lesson[]): void {
  const emptyLessons: string[] = [];
  const emptyAnswers: string[] = [];
  const degenerateButtons: string[] = [];
  const duplicateButtonOptions: string[] = [];
  const selfDistractors: string[] = [];

  for (const lesson of lessons) {
    if (lesson.exercises.length === 0) emptyLessons.push(lesson.id);

    for (const [index, exercise] of lesson.exercises.entries()) {
      const ref = `${lesson.id}#${index}`;
      if (exercise.answer.trim().length === 0) emptyAnswers.push(ref);
      if (isButtonExercise(exercise.type) && (exercise.distractors?.length ?? 0) === 0) {
        degenerateButtons.push(ref);
      }
      if (isButtonExercise(exercise.type)) {
        const options = [exercise.answer, ...(exercise.distractors ?? [])];
        if (new Set(options).size !== options.length) duplicateButtonOptions.push(ref);
        if ((exercise.distractors ?? []).includes(exercise.answer)) selfDistractors.push(ref);
      }
    }
  }

  expect(emptyLessons).toEqual([]);
  expect(emptyAnswers).toEqual([]);
  expect(degenerateButtons).toEqual([]);
  expect(duplicateButtonOptions).toEqual([]);
  expect(selfDistractors).toEqual([]);
}

function expectReachableLessons(lessons: Lesson[]): void {
  const reachable = new Set(
    lessons
      .filter((lesson) => lesson.prerequisites.length === 0)
      .map((lesson) => lesson.id)
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const lesson of lessons) {
      if (reachable.has(lesson.id)) continue;
      if (lesson.prerequisites.every((prerequisite) => reachable.has(prerequisite))) {
        reachable.add(lesson.id);
        changed = true;
      }
    }
  }

  const unreachable = lessons
    .map((lesson) => lesson.id)
    .filter((lessonId) => !reachable.has(lessonId));

  expect(unreachable).toEqual([]);
}

describe("Japanese lesson catalog", () => {
  test("registers the four progress units from the same lesson registry", () => {
    expectRegisteredUnits(japaneseLessons, japaneseUnits, EXPECTED_JAPANESE_UNIT_NAMES);
  });

  test("has no duplicate lesson IDs", () => {
    expectUniqueLessonIds(japaneseLessons);
  });

  test("all prerequisites and unit lesson references resolve", () => {
    expectResolvedLessonReferences(japaneseLessons, japaneseUnits);
  });

  test("every lesson has valid exercises", () => {
    expectValidLessonExercises(japaneseLessons);
  });

  test("all lessons are reachable from root lessons through prerequisites", () => {
    expectReachableLessons(japaneseLessons);
  });

  test("adds exactly 50 unique basic kanji SRS items", () => {
    const srsTerms = japaneseLessons
      .filter((lesson) => lesson.unit === "kanji")
      .flatMap((lesson) => lesson.srsItems?.map((item) => item.front) ?? []);

    expect(srsTerms).toHaveLength(50);
    expect(new Set(srsTerms).size).toBe(50);
  });
});

describe("Chinese lesson catalog", () => {
  test("registers the three HSK 1 progress units from the same lesson registry", () => {
    expectRegisteredUnits(chineseLessons, chineseUnits, EXPECTED_CHINESE_UNIT_NAMES);
  });

  test("has no duplicate lesson IDs", () => {
    expectUniqueLessonIds(chineseLessons);
  });

  test("all prerequisites and unit lesson references resolve", () => {
    expectResolvedLessonReferences(chineseLessons, chineseUnits);
  });

  test("every lesson has valid exercises", () => {
    expectValidLessonExercises(chineseLessons);
  });

  test("all lessons are reachable from root lessons through prerequisites", () => {
    expectReachableLessons(chineseLessons);
  });

  test("adds exactly 150 unique HSK 1 vocabulary SRS items", () => {
    const expectedTerms = new Set(chineseHsk1VocabularyItems.map((item) => item.term));
    const srsTerms = chineseLessons
      .filter((lesson) => lesson.unit === "vocabulary")
      .flatMap((lesson) => lesson.srsItems?.map((item) => item.front) ?? []);

    expect(chineseHsk1VocabularyItems).toHaveLength(150);
    expect(srsTerms).toHaveLength(150);
    expect(new Set(srsTerms)).toEqual(expectedTerms);
  });

  test("generated Chinese production prompts ask for hanzi, not Japanese", () => {
    const productionPrompts = chineseLessons
      .flatMap((lesson) => lesson.exercises)
      .filter((exercise) => exercise.type === "production")
      .map((exercise) => exercise.prompt);

    expect(productionPrompts.length).toBeGreaterThan(0);
    for (const prompt of productionPrompts) {
      expect(prompt).toContain("Type the hanzi");
      expect(prompt).not.toContain("Type the Japanese");
    }
  });
});

describe("French lesson catalog", () => {
  test("registers the three A1 progress units from the same lesson registry", () => {
    expectRegisteredUnits(frenchLessons, frenchUnits, EXPECTED_FRENCH_UNIT_NAMES);
  });

  test("has no duplicate lesson IDs", () => {
    expectUniqueLessonIds(frenchLessons);
  });

  test("all prerequisites and unit lesson references resolve", () => {
    expectResolvedLessonReferences(frenchLessons, frenchUnits);
  });

  test("every lesson has valid exercises", () => {
    expectValidLessonExercises(frenchLessons);
  });

  test("all lessons are reachable from root lessons through prerequisites", () => {
    expectReachableLessons(frenchLessons);
  });

  test("adds 100+ unique A1 vocabulary SRS items", () => {
    const expectedTerms = new Set(frenchA1VocabularyItems.map((item) => item.term));
    const srsTerms = frenchLessons
      .filter((lesson) => lesson.unit === "vocabulary")
      .flatMap((lesson) => lesson.srsItems?.map((item) => item.front) ?? []);

    expect(frenchA1VocabularyItems.length).toBeGreaterThanOrEqual(100);
    expect(srsTerms).toHaveLength(frenchA1VocabularyItems.length);
    expect(new Set(srsTerms)).toEqual(expectedTerms);
  });

  test("generated French production prompts ask for French", () => {
    const productionPrompts = frenchLessons
      .flatMap((lesson) => lesson.exercises)
      .filter((exercise) => exercise.type === "production")
      .map((exercise) => exercise.prompt);

    expect(productionPrompts.length).toBeGreaterThan(0);
    for (const prompt of productionPrompts) {
      expect(prompt).toContain("Type the French");
    }
  });
});
