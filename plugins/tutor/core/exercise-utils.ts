import type { ExerciseResult } from "./lesson-types.ts";
import type { Exercise } from "./lesson-types.ts";

export function shuffleArray<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function pickRandomItems<T>(items: readonly T[], count: number): T[] {
  return shuffleArray(items).slice(0, count);
}

export function getShuffledExerciseChoices(exercise: Exercise): string[] {
  return shuffleArray([exercise.answer, ...(exercise.distractors ?? [])]);
}

export function countCorrectResults(
  results: readonly Pick<ExerciseResult, "correct">[] | null | undefined,
): number {
  return results?.reduce((count, result) => count + (result.correct ? 1 : 0), 0) ?? 0;
}
