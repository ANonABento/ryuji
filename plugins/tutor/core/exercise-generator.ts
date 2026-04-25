/**
 * Exercise generator — creates exercises from content sets.
 *
 * A ContentSet defines WHAT to teach (items). The generator creates
 * HOW to practice it (exercises) based on the selected mode.
 * One content set → multiple exercise modes → 3x variety.
 */

import type { ContentItem, ContentSet, Exercise, ExerciseMode, Lesson, LessonPracticeMode } from "./lesson-types.ts";
export type { ContentItem, ContentSet, ExerciseMode } from "./lesson-types.ts";

/**
 * Generate exercises from a content set in a given mode.
 *
 * - recognition: see term → pick meaning (buttons)
 * - production: see meaning → type term
 * - matching: sequential match pairs (buttons)
 */
export function generateExercises(
  content: ContentSet,
  mode: ExerciseMode
): Exercise[] {
  const { items } = content;
  if (items.length === 0) return [];

  switch (mode) {
    case "recognition":
      return generateRecognition(items);
    case "production":
      return generateProduction(items);
    case "matching":
      return generateMatching(items);
  }
}

const ALL_MODES: ExerciseMode[] = ["recognition", "production", "matching"];

/** Generate all available exercises from a content set (one per mode) */
export function generateAllExercises(content: ContentSet): Exercise[] {
  const modes = content.modes ?? ALL_MODES;
  const exercises: Exercise[] = [];
  for (const mode of modes) {
    exercises.push(...generateExercises(content, mode));
  }
  return exercises;
}

const MODE_TYPES: Record<ExerciseMode, Exercise["type"][]> = {
  recognition: ["recognition", "multiple_choice", "chart"],
  production: ["production", "cloze", "error_correction", "sentence_build"],
  matching: ["matching"],
};

/** Select the concrete exercise list that should be scored for a lesson mode. */
export function selectExercisesForMode(lesson: Lesson, mode: LessonPracticeMode): Exercise[] {
  if (mode === "mixed") return lesson.exercises;
  const allowed = new Set(MODE_TYPES[mode]);
  return lesson.exercises.filter((exercise) => allowed.has(exercise.type));
}

/** Return modes that can produce at least one exercise for this concrete lesson. */
export function getAvailablePracticeModes(lesson: Lesson): LessonPracticeMode[] {
  const modes = ALL_MODES.filter((mode) => selectExercisesForMode(lesson, mode).length > 0);
  return modes.length > 1 ? ["mixed", ...modes] : ["mixed"];
}

// --- Recognition: see term → pick meaning ---

function generateRecognition(items: ContentItem[]): Exercise[] {
  return items.map((item) => {
    const distractors = items
      .filter((i) => i.meaning !== item.meaning)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((i) => i.meaning);

    return {
      type: "recognition" as const,
      prompt: `What does **${item.term}** (${item.reading}) mean?`,
      answer: item.meaning,
      distractors,
    };
  });
}

// --- Production: see meaning → type term ---

function generateProduction(items: ContentItem[]): Exercise[] {
  return items.map((item) => ({
    type: "production" as const,
    prompt: `Type the Japanese for **"${item.meaning}"**`,
    answer: item.term,
    accept: [item.reading], // accept reading as alternative
  }));
}

// --- Matching: sequential pair matching via buttons ---

function generateMatching(items: ContentItem[]): Exercise[] {
  // Create match exercises in groups of up to 5 pairs
  const exercises: Exercise[] = [];
  const maxPerGroup = 5;

  for (let i = 0; i < items.length; i += maxPerGroup) {
    const group = items.slice(i, i + maxPerGroup);
    if (group.length < 2) {
      // Too few for matching, fall back to recognition
      exercises.push(...generateRecognition(group));
      continue;
    }

    // Create one exercise per pair in the group
    // Each exercise shows a term and asks to pick the matching meaning
    for (const item of group) {
      const distractors = group
        .filter((g) => g.meaning !== item.meaning)
        .map((g) => g.meaning);

      exercises.push({
        type: "matching" as const,
        prompt: `**Match:** ${item.term} (${item.reading}) → ?`,
        answer: item.meaning,
        distractors,
      });
    }
  }

  return exercises;
}
