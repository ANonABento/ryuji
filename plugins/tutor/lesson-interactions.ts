/**
 * Lesson slash commands + button handlers.
 *
 * All lesson flow is handled via Discord interactions — no Claude roundtrip.
 * /lesson → start/continue a lesson
 * /progress → show learning progress
 * Buttons handle exercise answers (recognition, MC, navigation).
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
} from "discord.js";
import { registerCommand, registerButtonHandler } from "@choomfie/shared";
import { getLessonDB } from "./core/lesson-db-instance.ts";
import { getActiveModule } from "./core/session.ts";
import {
  getNextLesson,
  startLesson,
  scoreExercise,
  completeLesson,
  getProgressData,
  getLesson,
  getUnits,
} from "./core/lesson-engine.ts";
import { type Exercise, type Lesson, isButtonExercise } from "./core/lesson-types.ts";
import { updateFromLessonCompletion } from "./core/learner-profile.ts";

// --- Active lesson sessions (in-memory, keyed by userId) ---

export interface ActiveSession {
  userId: string;
  module: string;
  lessonId: string;
  exerciseIndex: number;
  lesson: Lesson;
  answerOptions: Map<number, Map<string, string>>;
}

const activeSessions = new Map<string, ActiveSession>();

// --- Helpers ---

function buildIntroEmbed(lesson: Lesson): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2) // blurple
    .setTitle(`📖 Lesson ${lesson.id}: ${lesson.title}`)
    .setDescription(lesson.introduction.text);

  if (lesson.introduction.items && lesson.introduction.items.length > 0) {
    const lines = lesson.introduction.items.map((item) => {
      if (item.char) {
        // Kana lesson
        let line = `**${item.char}** → **${item.reading}**`;
        if (item.mnemonic) line += ` — ${item.mnemonic}`;
        if (item.audioHint) line += ` *(${item.audioHint})*`;
        return line;
      } else if (item.word) {
        // Word/phrase lesson
        let line = `**${item.word}** (${item.reading})`;
        if (item.meaning) line += ` — ${item.meaning}`;
        return line;
      }
      return "";
    });
    embed.addFields({ name: "New Material", value: lines.join("\n") });
  }

  embed.setFooter({ text: `${lesson.exercises.length} exercises · 80% to pass` });
  return embed;
}

function buildExerciseEmbed(
  lesson: Lesson,
  exerciseIndex: number,
  exercise: Exercise
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xfee75c) // yellow
    .setTitle(`Exercise ${exerciseIndex + 1}/${lesson.exercises.length}`)
    .setDescription(exercise.prompt);

  if (exercise.hint) {
    embed.setFooter({ text: `💡 Hint: ${exercise.hint}` });
  }

  return embed;
}

export function buildAnswerCustomId(
  lessonId: string,
  exerciseIndex: number,
  optionToken: string
): string {
  return `lesson:answer:${lessonId}:${exerciseIndex}:${optionToken}`;
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function buildButtonOptions(exercise: Exercise): string[] {
  if (!isButtonExercise(exercise.type)) return [];
  const distractors = [...new Set(exercise.distractors ?? [])].filter(
    (option) => option !== exercise.answer
  );
  const selectedDistractors = shuffle(distractors).slice(0, 4);
  return shuffle([exercise.answer, ...selectedDistractors]);
}

function buttonLabel(answer: string): string {
  return answer.length > 80 ? `${answer.slice(0, 77)}...` : answer;
}

function getOrCreateAnswerOptions(
  exercise: Exercise,
  exerciseIndex: number,
  session: ActiveSession
): Map<string, string> {
  const existing = session.answerOptions.get(exerciseIndex);
  if (existing) return existing;

  const answersByToken = new Map<string, string>();
  buildButtonOptions(exercise).forEach((option, index) => {
    answersByToken.set(String(index), option);
  });
  session.answerOptions.set(exerciseIndex, answersByToken);
  return answersByToken;
}

export function buildExerciseButtons(
  exercise: Exercise,
  lessonId: string,
  exerciseIndex: number,
  session: ActiveSession
): ActionRowBuilder<ButtonBuilder>[] {
  if (isButtonExercise(exercise.type)) {
    const answersByToken = getOrCreateAnswerOptions(exercise, exerciseIndex, session);
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const [token, option] of answersByToken) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(buildAnswerCustomId(lessonId, exerciseIndex, token))
          .setLabel(buttonLabel(option))
          .setStyle(ButtonStyle.Secondary)
      );
    }
    return [row];
  }

  // Production/cloze — no buttons, user types answer
  session.answerOptions.delete(exerciseIndex);
  return [];
}

function buildResultEmbed(
  correct: boolean,
  feedback: string,
  correctSoFar: number,
  total: number
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(correct ? 0x57f287 : 0xed4245)
    .setDescription(feedback)
    .setFooter({ text: `Score: ${correctSoFar}/${total}` });
}

function buildSummaryEmbed(
  lesson: Lesson,
  score: number,
  passed: boolean,
  totalCorrect: number,
  totalExercises: number
): EmbedBuilder {
  const pct = Math.round(score * 100);
  const bar = buildProgressBar(score, 15);

  const embed = new EmbedBuilder()
    .setTitle(passed ? "🎉 Lesson Complete!" : "📝 Keep Practicing!")
    .setColor(passed ? 0x57f287 : 0xfee75c)
    .setDescription(
      passed
        ? `**${lesson.title}** — ${pct}% (${totalCorrect}/${totalExercises})\n${bar}\n\nGreat work! Next lesson unlocked.`
        : `**${lesson.title}** — ${pct}% (${totalCorrect}/${totalExercises})\n${bar}\n\nYou need 80% to advance. Try again!`
    );

  if (passed && lesson.srsItems && lesson.srsItems.length > 0) {
    embed.addFields({
      name: "📚 Added to SRS",
      value: `${lesson.srsItems.length} items added to your review deck`,
    });
  }

  return embed;
}

function buildProgressBar(ratio: number, length: number): string {
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return `[${"\u2588".repeat(filled)}${"\u2500".repeat(empty)}] ${Math.round(ratio * 100)}%`;
}

// --- Send next exercise or summary ---

async function sendNextExercise(
  interaction: ButtonInteraction,
  session: ActiveSession,
  editMessage: boolean = false
) {
  const db = getLessonDB();
  if (!db) return;

  const { lesson, exerciseIndex, userId, module, lessonId } = session;

  // All exercises done?
  if (exerciseIndex >= lesson.exercises.length) {
    const result = completeLesson(db, userId, module, lessonId);
    activeSessions.delete(userId);

    // Update learner profile
    updateFromLessonCompletion(db, userId, module);

    const summary = buildSummaryEmbed(lesson, result.score, result.passed, result.totalCorrect, result.totalExercises);

    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (result.passed) {
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
            .setCustomId(`lesson:retry:${lessonId}`)
            .setLabel("Try Again")
            .setStyle(ButtonStyle.Primary)
        )
      );
    }

    if (editMessage) {
      await interaction.update({ embeds: [summary], components });
    } else {
      await interaction.followUp({ embeds: [summary], components });
    }
    return;
  }

  const exercise = lesson.exercises[exerciseIndex];
  const embed = buildExerciseEmbed(lesson, exerciseIndex, exercise);
  const buttons = buildExerciseButtons(exercise, lessonId, exerciseIndex, session);

  const isTypingExercise = buttons.length === 0;
  if (isTypingExercise) {
    embed.setFooter({
      text: `Type your answer below${exercise.hint ? ` · 💡 ${exercise.hint}` : ""}`,
    });
  }

  if (editMessage) {
    await interaction.update({ embeds: [embed], components: buttons });
  } else {
    await interaction.followUp({ embeds: [embed], components: buttons });
  }
}

// --- Slash Commands ---

registerCommand("lesson", {
  data: new SlashCommandBuilder()
    .setName("lesson")
    .setDescription("Start or continue a Japanese lesson")
    .toJSON(),
  handler: async (interaction, ctx) => {
    const db = getLessonDB();
    if (!db) {
      await interaction.reply({
        content: "Tutor plugin not initialized.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const userId = interaction.user.id;
    const module = getActiveModule(userId);

    // Check for active session
    const existing = activeSessions.get(userId);
    if (existing) {
      // Resume
      const exercise = existing.lesson.exercises[existing.exerciseIndex];
      if (!exercise) {
        activeSessions.delete(userId);
      } else {
        const embed = buildExerciseEmbed(existing.lesson, existing.exerciseIndex, exercise);
        const buttons = buildExerciseButtons(
          exercise,
          existing.lessonId,
          existing.exerciseIndex,
          existing
        );
        await interaction.reply({ embeds: [embed], components: buttons });
        return;
      }
    }

    const next = getNextLesson(db, userId, module);
    if (!next) {
      await interaction.reply({
        content: "🎉 You've completed all available lessons! More coming soon.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = startLesson(db, userId, module, next.id);
    if (!result) {
      await interaction.reply({
        content: "Could not start lesson.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Create active session
    const session: ActiveSession = {
      userId,
      module,
      lessonId: next.id,
      exerciseIndex: result.resumeAt,
      lesson: result.lesson,
      answerOptions: new Map(),
    };
    activeSessions.set(userId, session);

    // Show intro
    const intro = buildIntroEmbed(result.lesson);
    const startButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lesson:start:${next.id}`)
        .setLabel("Start Exercises →")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({ embeds: [intro], components: [startButton] });
  },
});

registerCommand("progress", {
  data: new SlashCommandBuilder()
    .setName("progress")
    .setDescription("Show your learning progress")
    .toJSON(),
  handler: async (interaction) => {
    const db = getLessonDB();
    if (!db) {
      await interaction.reply({
        content: "Tutor plugin not initialized.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const userId = interaction.user.id;
    const module = getActiveModule(userId);
    const data = getProgressData(db, userId, module);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📚 ${module.charAt(0).toUpperCase() + module.slice(1)} — Progress`);

    if (data.units.length === 0) {
      embed.setDescription("No lessons available yet.");
    } else {
      const lines = data.units.map((u) => {
        if (u.status === "locked") {
          return `${u.unit.icon} **${u.unit.name}**  [🔒 locked]`;
        }
        const bar = buildProgressBar(u.total > 0 ? u.completed / u.total : 0, 15);
        const check = u.status === "completed" ? "  ✓" : "";
        return `${u.unit.icon} **${u.unit.name}**  ${bar}${check}`;
      });
      embed.setDescription(lines.join("\n"));
    }

    embed.setFooter({
      text: `📖 ${data.totalCompleted}/${data.totalLessons} lessons completed`,
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
});

// --- Button Handlers ---

registerButtonHandler("lesson", async (interaction, parts, ctx) => {
  const action = parts[1];
  const userId = interaction.user.id;
  const db = getLessonDB();
  if (!db) return;

  if (action === "start") {
    // Start exercises from intro screen
    const session = activeSessions.get(userId);
    if (!session) {
      await interaction.reply({
        content: "Session expired. Use `/lesson` to start again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await sendNextExercise(interaction, session, true);
    return;
  }

  if (action === "answer") {
    // Button answer for recognition/MC exercises
    const lessonId = parts[2];
    const exerciseIndex = parseInt(parts[3], 10);
    const answerToken = parts[4];

    const session = activeSessions.get(userId);
    if (!session || session.lessonId !== lessonId) {
      await interaction.reply({
        content: "Session expired. Use `/lesson` to start again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (session.exerciseIndex !== exerciseIndex) {
      await interaction.reply({
        content: "That exercise is no longer active. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const exercise = session.lesson.exercises[exerciseIndex];
    if (!exercise) return;

    const userAnswer = session.answerOptions.get(exerciseIndex)?.get(answerToken);
    if (userAnswer === undefined) {
      await interaction.reply({
        content: "That answer option expired. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = scoreExercise(exercise, userAnswer);
    result.index = exerciseIndex;

    // Save to DB
    db.saveExerciseResult(userId, session.module, lessonId, exerciseIndex, {
      index: exerciseIndex,
      correct: result.correct,
      userAnswer,
    });

    // Count correct so far (progress already includes the just-saved result)
    const progress = db.getProgress(userId, session.module, lessonId);
    const correctSoFar = progress?.exerciseResults.filter((r) => r.correct).length ?? 0;

    // Move to next exercise
    session.exerciseIndex = exerciseIndex + 1;
    session.answerOptions.delete(exerciseIndex);

    // Show result briefly then move on
    const resultEmbed = buildResultEmbed(
      result.correct,
      result.feedback,
      correctSoFar,
      session.lesson.exercises.length
    );

    const continueButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lesson:continue:${lessonId}`)
        .setLabel("Continue →")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.update({ embeds: [resultEmbed], components: [continueButton] });
    return;
  }

  if (action === "continue") {
    const session = activeSessions.get(userId);
    if (!session) {
      await interaction.reply({
        content: "Session expired. Use `/lesson` to start again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await sendNextExercise(interaction, session, true);
    return;
  }

  if (action === "next") {
    // Start next available lesson
    const module = getActiveModule(userId);
    const next = getNextLesson(db, userId, module);
    if (!next) {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🎉 All lessons complete!")
            .setDescription("You've finished all available lessons. More coming soon!"),
        ],
        components: [],
      });
      return;
    }

    const result = startLesson(db, userId, module, next.id);
    if (!result) return;

    const session: ActiveSession = {
      userId,
      module,
      lessonId: next.id,
      exerciseIndex: result.resumeAt,
      lesson: result.lesson,
      answerOptions: new Map(),
    };
    activeSessions.set(userId, session);

    const intro = buildIntroEmbed(result.lesson);
    const startButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lesson:start:${next.id}`)
        .setLabel("Start Exercises →")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.update({ embeds: [intro], components: [startButton] });
    return;
  }

  if (action === "retry") {
    const lessonId = parts[2];
    const module = getActiveModule(userId);

    const result = startLesson(db, userId, module, lessonId);
    if (!result) return;

    const session: ActiveSession = {
      userId,
      module,
      lessonId,
      exerciseIndex: 0,
      lesson: result.lesson,
      answerOptions: new Map(),
    };
    activeSessions.set(userId, session);

    const intro = buildIntroEmbed(result.lesson);
    const startButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lesson:start:${lessonId}`)
        .setLabel("Start Exercises →")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.update({ embeds: [intro], components: [startButton] });
    return;
  }
});

// --- Handle typed answers for production/cloze exercises ---

/**
 * Called from plugin.onMessage when user has an active lesson session
 * and the current exercise requires typing.
 */
export function handleTypedAnswer(
  userId: string,
  text: string
): { result: ReturnType<typeof scoreExercise>; session: ActiveSession } | null {
  const session = activeSessions.get(userId);
  if (!session) return null;

  const exercise = session.lesson.exercises[session.exerciseIndex];
  if (!exercise) return null;

  // Only handle typing exercises
  if (exercise.type !== "production" && exercise.type !== "cloze") return null;

  const db = getLessonDB();
  if (!db) return null;

  const result = scoreExercise(exercise, text);
  result.index = session.exerciseIndex;

  db.saveExerciseResult(userId, session.module, session.lessonId, session.exerciseIndex, {
    index: session.exerciseIndex,
    correct: result.correct,
    userAnswer: text,
  });

  session.exerciseIndex++;
  return { result, session };
}

/** Check if a user has an active typing exercise */
export function hasActiveTypingExercise(userId: string): boolean {
  const session = activeSessions.get(userId);
  if (!session) return false;
  const exercise = session.lesson.exercises[session.exerciseIndex];
  if (!exercise) return false;
  return exercise.type === "production" || exercise.type === "cloze";
}

/** Get active session for a user */
export function getActiveSession(userId: string): ActiveSession | undefined {
  return activeSessions.get(userId);
}

/** Clear active session for a user */
export function clearActiveSession(userId: string): void {
  activeSessions.delete(userId);
}
