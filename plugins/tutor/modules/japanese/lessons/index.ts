/**
 * Japanese lesson registry — loads and organizes all lesson data.
 */

import type { Lesson, Unit } from "../../../core/lesson-types.ts";
import { hiraganaLessons } from "./unit-1-hiragana.ts";
import { katakanaLessons } from "./unit-2-katakana.ts";
import { phraseLessons } from "./unit-3-phrases.ts";
import { grammarLessons } from "./unit-4-grammar.ts";

/** All Japanese lessons in order */
export const japaneseLessons: Lesson[] = [
  ...hiraganaLessons,
  ...katakanaLessons,
  ...phraseLessons,
  ...grammarLessons,
];

/** Unit definitions for progress display */
export const japaneseUnits: Unit[] = [
  {
    index: 1,
    id: "hiragana",
    name: "Hiragana",
    icon: "🔤",
    lessonIds: hiraganaLessons.map((l) => l.id),
  },
  {
    index: 2,
    id: "katakana",
    name: "Katakana",
    icon: "🔡",
    lessonIds: katakanaLessons.map((l) => l.id),
  },
  {
    index: 3,
    id: "phrases",
    name: "First Words & Phrases",
    icon: "💬",
    lessonIds: phraseLessons.map((l) => l.id),
  },
  {
    index: 4,
    id: "grammar",
    name: "Basic Grammar",
    icon: "📝",
    lessonIds: grammarLessons.map((l) => l.id),
  },
];
