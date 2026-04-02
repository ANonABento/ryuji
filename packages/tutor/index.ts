/**
 * Tutor plugin — modular teaching harness.
 *
 * Generalizes the language-learning plugin to support any teachable subject.
 * Japanese is the first module; more can be added by implementing TutorModule.
 *
 * Phase 2: Structured lesson system with mastery-gated progression.
 * Lessons are driven by Discord interactions (/lesson + buttons) — no Claude roundtrip.
 */

import type { Plugin } from "@choomfie/shared";
import { SRSManager } from "./core/srs.ts";
import { setSRS } from "./core/srs-instance.ts";
import { LessonDB } from "./core/lesson-db.ts";
import { setLessonDB, getLessonDB } from "./core/lesson-db-instance.ts";
import { registerLessons } from "./core/lesson-engine.ts";
import { getAllTutorTools } from "./tools/index.ts";
import { listModules } from "./modules/index.ts";
import { japaneseLessons, japaneseUnits } from "./modules/japanese/lessons/index.ts";

// Side-effect import: registers /lesson, /progress commands + button handlers
import "./lesson-interactions.ts";
import { hasActiveTypingExercise, handleTypedAnswer } from "./lesson-interactions.ts";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { completeLesson } from "./core/lesson-engine.ts";

const tutorPlugin: Plugin = {
  name: "tutor",

  tools: getAllTutorTools(),

  instructions: [
    "## Tutor",
    "You are also a tutor. When the user wants to learn or practice a subject:",
    "",
    "**Structured Lessons (recommended for beginners):**",
    "- Tell beginners to use `/lesson` to start structured lessons (hiragana → katakana → phrases → grammar)",
    "- Use `lesson_status` to check their progress and suggest what to study next",
    "- Lessons are button-driven and instant — no need for you to be in the loop",
    "",
    "**Other tools:**",
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
    "**Learning flow:** Lessons (learn new material) → SRS (retain it) → Conversation (use it naturally)",
    "",
    "Default: Japanese at N5 (complete beginner).",
    "Be encouraging! Learning is hard. Celebrate progress.",
    "When correcting, explain WHY something is wrong, don't just give the answer.",
    "For Japanese: use furigana for kanji: 食[た]べる",
    "",
    "SRS: Cards auto-import from JLPT N5 deck (718 words) on first review.",
    "Lesson completion also adds items to SRS automatically.",
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
    "lesson_status",
    "convert_kana",
  ],

  async onMessage(message, ctx) {
    // Handle typed answers for production/cloze exercises
    if (message.author.bot) return;
    const userId = message.author.id;

    if (!hasActiveTypingExercise(userId)) return;

    const result = handleTypedAnswer(userId, message.content);
    if (!result) return;

    const { result: exerciseResult, session } = result;

    // Get correct count from DB
    const db = getLessonDB();
    const progress = db?.getProgress(userId, session.module, session.lessonId);
    const correctSoFar = progress?.exerciseResults.filter((r) => r.correct).length ?? 0;

    const resultEmbed = new EmbedBuilder()
      .setColor(exerciseResult.correct ? 0x57f287 : 0xed4245)
      .setDescription(exerciseResult.feedback)
      .setFooter({ text: `Score: ${correctSoFar}/${session.lesson.exercises.length}` });

    // Check if lesson is done
    if (session.exerciseIndex >= session.lesson.exercises.length) {
      const completion = completeLesson(db!, userId, session.module, session.lessonId);
      const pct = Math.round(completion.score * 100);
      const passed = completion.passed;

      const summaryEmbed = new EmbedBuilder()
        .setTitle(passed ? "🎉 Lesson Complete!" : "📝 Keep Practicing!")
        .setColor(passed ? 0x57f287 : 0xfee75c)
        .setDescription(
          `**${session.lesson.title}** — ${pct}% (${completion.totalCorrect}/${completion.totalExercises})`
        );

      const components: ActionRowBuilder<ButtonBuilder>[] = [];
      if (passed) {
        if (session.lesson.srsItems && session.lesson.srsItems.length > 0) {
          summaryEmbed.addFields({
            name: "📚 Added to SRS",
            value: `${session.lesson.srsItems.length} items added to your review deck`,
          });
        }
        components.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId("lesson:next")
              .setLabel("Next Lesson →")
              .setStyle(ButtonStyle.Success)
          )
        );
      } else {
        components.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`lesson:retry:${session.lessonId}`)
              .setLabel("Try Again")
              .setStyle(ButtonStyle.Primary)
          )
        );
      }

      await message.reply({ embeds: [resultEmbed, summaryEmbed], components });
      return;
    }

    // Show next exercise
    const nextExercise = session.lesson.exercises[session.exerciseIndex];
    const exerciseEmbed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle(`Exercise ${session.exerciseIndex + 1}/${session.lesson.exercises.length}`)
      .setDescription(nextExercise.prompt);

    // Build buttons for MC exercises, or typing prompt
    const isTyping = nextExercise.type === "production" || nextExercise.type === "cloze";
    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    if (!isTyping && (nextExercise.type === "recognition" || nextExercise.type === "multiple_choice")) {
      const options = [nextExercise.answer, ...(nextExercise.distractors ?? [])];
      const shuffled = options.sort(() => Math.random() - 0.5);
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (let i = 0; i < Math.min(shuffled.length, 5); i++) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`lesson:answer:${session.lessonId}:${session.exerciseIndex}:${shuffled[i]}`)
            .setLabel(shuffled[i])
            .setStyle(ButtonStyle.Secondary)
        );
      }
      components.push(row);
    } else {
      exerciseEmbed.setFooter({
        text: `Type your answer below${nextExercise.hint ? ` · 💡 ${nextExercise.hint}` : ""}`,
      });
    }

    await message.reply({ embeds: [resultEmbed, exerciseEmbed], components });
  },

  async init(ctx) {
    // Initialize SRS
    const srs = new SRSManager(`${ctx.DATA_DIR}/srs.db`);
    setSRS(srs);
    console.error("Tutor: SRS initialized");

    // Initialize lesson DB (same directory, separate file)
    const lessonDb = new LessonDB(`${ctx.DATA_DIR}/lessons.db`);
    setLessonDB(lessonDb);
    console.error("Tutor: Lesson DB initialized");

    // Register lesson data
    registerLessons("japanese", japaneseLessons, japaneseUnits);
    console.error(`Tutor: registered ${japaneseLessons.length} Japanese lessons`);

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

    // Close lesson DB
    const { getLessonDB: getDB } = await import("./core/lesson-db-instance.ts");
    const lessonDb = getDB();
    if (lessonDb) {
      lessonDb.close();
      setLessonDB(null);
    }

    // Close SRS
    const { getSRS } = await import("./core/srs-instance.ts");
    const srs = getSRS();
    if (srs) {
      srs.close();
      setSRS(null);
    }
  },
};

export default tutorPlugin;
