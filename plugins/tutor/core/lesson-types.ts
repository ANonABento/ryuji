/**
 * Lesson system types — structured, mastery-gated progression.
 */

/** Runtime-generated practice mode for content sets. */
export type ExerciseMode = "recognition" | "production" | "matching";

/** User-facing mode choices for generated practice. */
export type PracticeMode = ExerciseMode | "mixed";

/** A single teachable item */
export interface ContentItem {
  term: string;
  reading: string;
  meaning: string;
}

/** A set of content that can generate exercises in multiple modes */
export interface ContentSet {
  items: ContentItem[];
  /** Which modes to generate. Defaults to all. */
  modes?: ExerciseMode[];
}

export interface ChartBlank {
  row: number;
  col: number;
  answer: string;
  reading?: string;
}

export interface ChartExerciseData {
  grid: (string | null)[][];
  blanks: ChartBlank[];
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
  accept?: string[]; // alternative accepted answers
  hint?: string;
  explanation?: string; // shown after answering (grammar lessons)
  chart?: ChartExerciseData; // structured chart data for chart exercises
  chartBlankIndex?: number; // runtime expansion index for chart blank scoring
}

/** A single teachable item that can generate exercises */
export interface ContentItem {
  term: string; // e.g. "あ" or "食べる"
  reading: string; // e.g. "a" or "たべる"
  meaning: string; // e.g. "a (vowel)" or "to eat"
}

/** Exercise generation mode */
export type ExerciseMode = "recognition" | "production" | "matching";

/** A set of content that can generate exercises in multiple modes */
export interface ContentSet {
  items: ContentItem[];
  /** Which modes to generate. Defaults to all. */
  modes?: ExerciseMode[];
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
  contentSets?: ContentSet[];
  selectableModes?: PracticeMode[];
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
  exerciseType?: Exercise["type"];
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
