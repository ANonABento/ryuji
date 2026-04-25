/**
 * Tutor module interface — each subject (language, math, trivia, etc.) implements this.
 *
 * Extends the concept of LanguageModule to support any teachable subject.
 * All capability methods are optional — modules implement what makes sense.
 */

import type { ToolDef } from "@choomfie/shared";

export interface DictionaryEntry {
  word: string;
  reading: string;
  meanings: string[];
  partOfSpeech: string[];
  level?: string; // e.g. "JLPT N5", "HSK 1"
  examples?: string[];
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

/** Optional context passed to buildTutorPrompt — derived from the user's active lesson. */
export interface TutorPromptContext {
  furiganaLevel?: "full" | "partial" | "none";
}

export interface TutorModule {
  /** Module identifier, e.g. "japanese", "math", "trivia" */
  name: string;
  /** Display name, e.g. "Japanese", "Mathematics" */
  displayName: string;
  /** Short description for listing */
  description: string;
  /** Emoji icon for UI */
  icon?: string;
  /** Proficiency levels for this module */
  levels: string[];
  /** Default level for new users */
  defaultLevel: string;

  /** Look up a word/term (languages: dictionary, programming: docs, etc.) */
  lookup?(query: string): Promise<DictionaryEntry[]>;

  /** Build a system prompt for the AI tutor at the given level. Optional
   *  per-lesson context lets modules adjust output (e.g. furigana density). */
  buildTutorPrompt?(level: string, ctx?: TutorPromptContext): string;

  /** Generate a quiz question at the given level */
  generateQuiz?(level: string, type: string): QuizQuestion;

  /** Available quiz types for this module (e.g. ["reading", "vocab", "grammar"]) */
  quizTypes?: string[];

  /** Module-specific tools (auto-registered alongside core tools) */
  tools?: ToolDef[];

  /** Lifecycle */
  init?(): Promise<void>;
  destroy?(): Promise<void>;
}
