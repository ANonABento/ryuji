/**
 * Tutor plugin — modular teaching harness.
 *
 * Generalizes the language-learning plugin to support any teachable subject.
 * Japanese is the first module; more can be added by implementing TutorModule.
 */

import type { Plugin } from "../../lib/types.ts";
import { SRSManager } from "./core/srs.ts";
import { setSRS } from "./core/srs-instance.ts";
import { getAllTutorTools } from "./tools/index.ts";
import { listModules } from "./modules/index.ts";

const tutorPlugin: Plugin = {
  name: "tutor",

  tools: getAllTutorTools(),

  instructions: [
    "## Tutor",
    "You are also a tutor. When the user wants to learn or practice a subject:",
    "",
    "1. Use `tutor_prompt` to get the tutoring guidelines for their level",
    "2. Follow those guidelines when teaching and correcting",
    "3. Use `dictionary_lookup` when they ask about a word or term",
    "4. Use `quiz` to test them",
    "5. Use `set_level` to change difficulty",
    "6. Use `switch_module` to change subjects",
    "7. Use `list_modules` to show available subjects",
    "8. Use `srs_review` to start a flashcard review session",
    "9. Use `srs_rate` after they answer a flashcard (again/hard/good/easy)",
    "10. Use `srs_stats` to show their progress",
    "11. Module-specific tools (e.g. `convert_kana` for Japanese) are also available",
    "",
    "Default: Japanese at N5 (complete beginner).",
    "Be encouraging! Learning is hard. Celebrate progress.",
    "When correcting, explain WHY something is wrong, don't just give the answer.",
    "For Japanese: use furigana for kanji: 食[た]べる",
    "",
    "SRS: Cards auto-import from JLPT N5 deck (718 words) on first review.",
    "The FSRS algorithm schedules reviews optimally — trust the intervals.",
  ],

  userTools: [
    "tutor_prompt",
    "dictionary_lookup",
    "quiz",
    "set_level",
    "switch_module",
    "list_modules",
    "srs_review",
    "srs_rate",
    "srs_stats",
    "convert_kana",
  ],

  async init(ctx) {
    const srs = new SRSManager(`${ctx.DATA_DIR}/srs.db`);
    setSRS(srs);
    console.error("Tutor: SRS initialized");

    // Initialize all modules
    for (const mod of listModules()) {
      if (mod.init) {
        try {
          await mod.init();
          console.error(`Tutor: module "${mod.name}" initialized`);
        } catch (e) {
          console.error(`Tutor: module "${mod.name}" init failed (non-critical): ${e}`);
        }
      }
    }
  },

  async destroy() {
    // Destroy all modules
    for (const mod of listModules()) {
      if (mod.destroy) {
        try { await mod.destroy(); } catch {}
      }
    }

    const { getSRS } = await import("./core/srs-instance.ts");
    const srs = getSRS();
    if (srs) {
      srs.close();
      setSRS(null);
    }
  },
};

export default tutorPlugin;
