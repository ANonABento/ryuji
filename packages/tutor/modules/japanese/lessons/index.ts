/**
 * Japanese lesson registry — loads and organizes all lesson data.
 */

import type { Lesson, Unit } from "../../../core/lesson-types.ts";
import { hiraganaLessons } from "./unit-1-hiragana.ts";

/** All Japanese lessons in order */
export const japaneseLessons: Lesson[] = [...hiraganaLessons];

/** Unit definitions for progress display */
export const japaneseUnits: Unit[] = [
  {
    index: 1,
    id: "hiragana",
    name: "Hiragana",
    icon: "🔤",
    lessonIds: hiraganaLessons.map((l) => l.id),
  },
  // Future units:
  // { index: 2, id: "katakana", name: "Katakana", icon: "🔤", lessonIds: [...] },
  // { index: 3, id: "phrases", name: "First Words & Phrases", icon: "💬", lessonIds: [...] },
  // { index: 4, id: "grammar", name: "Basic Grammar", icon: "📝", lessonIds: [...] },
];
