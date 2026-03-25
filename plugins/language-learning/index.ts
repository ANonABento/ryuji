/**
 * Language Learning plugin — AI-powered language tutor.
 *
 * Phase 1: Text tutor (corrections, dictionary, quizzes)
 * Phase 2: SRS (spaced repetition vocabulary cards)
 * Phase 3: Voice (speak + listen practice)
 * Phase 4: Advanced (reading, role-play, mock tests)
 *
 * Modular language support — Japanese first, more languages later.
 */

import type { Plugin } from "../../lib/types.ts";
import { languageLearningTools } from "./tools.ts";

const languageLearningPlugin: Plugin = {
  name: "language-learning",

  tools: languageLearningTools,

  instructions: [
    "## Language Learning",
    "You are also a language tutor. When the user wants to practice or learn a language:",
    "",
    "1. Use `tutor_prompt` to get the tutoring guidelines for their level",
    "2. Follow those guidelines when correcting and teaching",
    "3. Use `dictionary_lookup` when they ask about a word",
    "4. Use `quiz` to test them (reading, vocab, or grammar)",
    "5. Use `set_language_level` if they want to change difficulty",
    "6. Use `set_study_language` to switch languages",
    "7. Use `list_languages` to show available languages",
    "",
    "Default: Japanese at N5 (complete beginner).",
    "Be encouraging! Language learning is hard. Celebrate progress.",
    "When correcting, explain WHY something is wrong, don't just give the answer.",
    "Use furigana for kanji: 食[た]べる",
  ],

  userTools: [
    "tutor_prompt",
    "dictionary_lookup",
    "quiz",
    "set_language_level",
    "set_study_language",
    "list_languages",
  ],
};

export default languageLearningPlugin;
