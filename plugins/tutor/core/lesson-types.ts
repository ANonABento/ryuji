/**
 * Lesson system types — structured, mastery-gated progression.
 */

/** Grid coordinate for a chart exercise blank. */
export interface ChartBlank {
  row: number;
  col: number;
  answer: string;
  reading?: string;
}

/** Structured chart metadata for chart exercises. */
export interface ChartExerciseData {
  grid: (string | null)[][];
  blanks: ChartBlank[];
  currentBlankIndex?: number;
  rowLabels?: string[];
  colLabels?: string[];
}

/** A single exercise within a lesson */
export interface Exercise {
  type:
    | "recognition" // see JP → pick meaning (buttons)
    | "production" // see meaning → type JP
    | "cloze" // fill the blank
    | "multiple_choice" // general MC (buttons)
    | "error_correction" // find the mistake
    | "sentence_build" // arrange words
    | "chart" // fill in partial kana grid
    | "matching"; // match term to meaning (buttons)
  prompt: string;
  answer: string;
  distractors?: string[]; // for MC/recognition (button labels)
  chart?: ChartExerciseData; // for chart exercises
  accept?: string[]; // alternative accepted answers
  hint?: string;
  explanation?: string; // shown after answering (grammar lessons)
}

/** An item to introduce in the lesson intro */
export interface IntroItem {
  char?: string; // for kana lessons
  word?: string; // for vocab/grammar lessons
  reading?: string;
  meaning?: string;
  mnemonic?: string;
  audioHint?: string; // pronunciation guide
  example?: string;
  explanation?: string; // for grammar lessons
}

/** Lesson introduction section */
export interface LessonIntro {
  text: string;
  items?: IntroItem[];
}

/** SRS item to add on lesson completion */
export interface LessonSRSItem {
  front: string;
  back: string;
  reading?: string;
  tags?: string;
}

/** Full lesson definition (loaded from JSON data files) */
export interface Lesson {
  id: string; // e.g. "1.1"
  unit: string; // e.g. "hiragana"
  unitIndex: number; // 1-based unit number
  title: string;
  prerequisites: string[]; // lesson IDs that must be completed first
  introduction: LessonIntro;
  exercises: Exercise[];
  srsItems?: LessonSRSItem[];
  skillsTaught?: string[];
  furiganaLevel?: "full" | "partial" | "none";
}

/** Unit metadata for progress display */
export interface Unit {
  index: number;
  id: string;
  name: string;
  icon: string;
  lessonIds: string[];
}

/** Per-exercise result (stored as JSON array in DB) */
export interface ExerciseResult {
  index: number;
  correct: boolean;
  userAnswer?: string;
}

/** Lesson progress status */
export type LessonStatus = "locked" | "available" | "in_progress" | "completed";

/** Returns true for exercise types that present answer choices as buttons */
export function isButtonExercise(type: Exercise["type"]): boolean {
  return (
    type === "recognition" ||
    type === "multiple_choice" ||
    type === "chart" ||
    type === "matching"
  );
}

/** Returns the active structured blank for a chart exercise, if present. */
export function getActiveChartBlank(exercise: Exercise): ChartBlank | null {
  if (exercise.type !== "chart" || !exercise.chart) return null;
  const index = exercise.chart.currentBlankIndex ?? 0;
  return exercise.chart.blanks[index] ?? null;
}
