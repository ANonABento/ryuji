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
} from "./core/lesson-engine.ts";
import {
  type ChartExercise,
  type Exercise,
  type Lesson,
  type LessonPracticeMode,
  isButtonExercise,
  isChartExercise,
} from "./core/lesson-types.ts";
import { updateFromLessonCompletion } from "./core/learner-profile.ts";
import { getAvailablePracticeModes, selectExercisesForMode } from "./core/exercise-generator.ts";
import { renderChartPrompt } from "./core/chart.ts";

// --- Active lesson sessions (in-memory, keyed by userId) ---

type AnswerOptionsByToken = Map<string, string>;
type AnswerOptionsKey = number | `${number}:${number}`;
type AnswerOptionsByExercise = Map<AnswerOptionsKey, AnswerOptionsByToken>;

export interface ChartProgress {
  currentBlankIndex: number;
  filledAnswers: Array<string | null>;
  correctByBlank: boolean[];
}

export interface ActiveLessonSession {
  userId: string;
  module: string;
  lessonId: string;
  exerciseIndex: number;
  lesson: Lesson;
  exerciseSet: Exercise[];
  selectedMode: LessonPracticeMode | null;
  answerOptionsByExercise: AnswerOptionsByExercise;
  chartProgressByExercise: Map<number, ChartProgress>;
}

const activeSessions = new Map<string, ActiveLessonSession>();

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
  exercise: Exercise,
  totalExercises: number = lesson.exercises.length,
  prompt: string = exercise.prompt
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xfee75c) // yellow
    .setTitle(`Exercise ${exerciseIndex + 1}/${totalExercises}`)
    .setDescription(prompt);

  if (exercise.hint) {
    embed.setFooter({ text: `💡 Hint: ${exercise.hint}` });
  }

  return embed;
}

export function buildAnswerCustomId(
  lessonId: string,
  exerciseIndex: number,
  optionToken: string,
  chartBlankIndex?: number
): string {
  const base = `lesson:answer:${lessonId}:${exerciseIndex}:${optionToken}`;
  return chartBlankIndex === undefined ? base : `${base}:${chartBlankIndex}`;
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

function parseExerciseIndex(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function parsePracticeMode(value: string | undefined): LessonPracticeMode | null {
  if (
    value === "mixed" ||
    value === "recognition" ||
    value === "production" ||
    value === "matching"
  ) {
    return value;
  }
  return null;
}

function answerOptionsKey(exerciseIndex: number, chartBlankIndex?: number): AnswerOptionsKey {
  return chartBlankIndex === undefined ? exerciseIndex : `${exerciseIndex}:${chartBlankIndex}`;
}

function sessionExerciseSet(session: ActiveLessonSession): Exercise[] {
  return session.exerciseSet.length > 0 ? session.exerciseSet : session.lesson.exercises;
}

function createChartProgress(exercise: ChartExercise): ChartProgress {
  return {
    currentBlankIndex: 0,
    filledAnswers: exercise.blanks.map(() => null),
    correctByBlank: exercise.blanks.map(() => false),
  };
}

function getChartProgress(
  session: ActiveLessonSession,
  exerciseIndex: number,
  exercise: ChartExercise
): ChartProgress {
  const existing = session.chartProgressByExercise.get(exerciseIndex);
  if (existing) return existing;
  const progress = createChartProgress(exercise);
  session.chartProgressByExercise.set(exerciseIndex, progress);
  return progress;
}

function exercisePromptForSession(
  session: ActiveLessonSession,
  exerciseIndex: number,
  exercise: Exercise
): string {
  if (!isChartExercise(exercise)) return exercise.prompt;
  const progress = getChartProgress(session, exerciseIndex, exercise);
  return renderChartPrompt(exercise, progress);
}

export function isTypingExercise(exercise: Exercise): boolean {
  return !isButtonExercise(exercise.type);
}

function setActiveLessonSession(
  userId: string,
  module: string,
  lessonId: string,
  lesson: Lesson,
  exerciseIndex: number,
  selectedMode: LessonPracticeMode | null = null,
  exerciseSet: Exercise[] = lesson.exercises
): ActiveLessonSession {
  const session: ActiveLessonSession = {
    userId,
    module,
    lessonId,
    exerciseIndex,
    lesson,
    exerciseSet,
    selectedMode,
    answerOptionsByExercise: new Map(),
    chartProgressByExercise: new Map(),
  };
  activeSessions.set(userId, session);
  return session;
}

function getOrCreateAnswerOptions(
  exercise: Exercise,
  exerciseIndex: number,
  session: ActiveLessonSession,
  chartBlankIndex?: number
): AnswerOptionsByToken {
  const key = answerOptionsKey(exerciseIndex, chartBlankIndex);
  const existing = session.answerOptionsByExercise.get(key);
  if (existing) return existing;

  const answersByToken: AnswerOptionsByToken = new Map();
  const options =
    chartBlankIndex !== undefined && isChartExercise(exercise)
      ? buildButtonOptions({
          ...exercise,
          answer: exercise.blanks[chartBlankIndex]?.answer ?? exercise.answer,
        })
      : buildButtonOptions(exercise);

  options.forEach((option, index) => {
    answersByToken.set(String(index), option);
  });
  session.answerOptionsByExercise.set(key, answersByToken);
  return answersByToken;
}

export function buildExerciseButtons(
  exercise: Exercise,
  lessonId: string,
  exerciseIndex: number,
  session: ActiveLessonSession
): ActionRowBuilder<ButtonBuilder>[] {
  if (isButtonExercise(exercise.type)) {
    const chartBlankIndex =
      isChartExercise(exercise)
        ? getChartProgress(session, exerciseIndex, exercise).currentBlankIndex
        : undefined;
    const answersByToken = getOrCreateAnswerOptions(
      exercise,
      exerciseIndex,
      session,
      chartBlankIndex
    );
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const [token, option] of answersByToken) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(buildAnswerCustomId(lessonId, exerciseIndex, token, chartBlankIndex))
          .setLabel(buttonLabel(option))
          .setStyle(ButtonStyle.Secondary)
      );
    }
    return [row];
  }

  // Production/cloze — no buttons, user types answer
  session.answerOptionsByExercise.delete(exerciseIndex);
  return [];
}

export function buildResultEmbed(
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

export function buildSummaryEmbed(
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

export function buildLessonCompletionComponents(
  passed: boolean,
  lessonId: string
): ActionRowBuilder<ButtonBuilder>[] {
  const customId = passed ? "lesson:next" : `lesson:retry:${lessonId}`;
  const label = passed ? "Next Lesson →" : "Try Again";
  const style = passed ? ButtonStyle.Success : ButtonStyle.Primary;

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style)
    ),
  ];
}

function buildContinueComponents(lessonId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lesson:continue:${lessonId}`)
        .setLabel("Continue →")
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

const MODE_LABELS: Record<LessonPracticeMode, string> = {
  mixed: "Mixed",
  recognition: "Multiple Choice",
  production: "Spelling",
  matching: "Matching",
};

export function buildModePickerComponents(lesson: Lesson): ActionRowBuilder<ButtonBuilder>[] {
  const modes = getAvailablePracticeModes(lesson);
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...modes.map((mode) =>
        new ButtonBuilder()
          .setCustomId(`lesson:mode:${lesson.id}:${mode}`)
          .setLabel(MODE_LABELS[mode])
          .setStyle(mode === "mixed" ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    ),
  ];
}

function selectSessionMode(
  session: ActiveLessonSession,
  mode: LessonPracticeMode
): ActiveLessonSession {
  const selected = selectExercisesForMode(session.lesson, mode);
  session.selectedMode = mode;
  session.exerciseSet = selected.length > 0 ? selected : session.lesson.exercises;
  session.exerciseIndex = 0;
  session.answerOptionsByExercise.clear();
  session.chartProgressByExercise.clear();
  return session;
}

function hasSelectedPracticeMode(session: ActiveLessonSession): boolean {
  return session.selectedMode !== null;
}

async function replyPracticeModeAlreadySelected(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({
    content: "Practice mode is already selected. Use `/lesson` to continue.",
    flags: MessageFlags.Ephemeral,
  });
}

function buildProgressBar(ratio: number, length: number): string {
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return `[${"\u2588".repeat(filled)}${"\u2500".repeat(empty)}] ${Math.round(ratio * 100)}%`;
}

// --- Send next exercise or summary ---

async function sendNextExercise(
  interaction: ButtonInteraction,
  session: ActiveLessonSession,
  editMessage: boolean = false
) {
  const db = getLessonDB();
  if (!db) return;

  const { lesson, exerciseIndex, userId, module, lessonId } = session;
  const exerciseSet = sessionExerciseSet(session);

  // All exercises done?
  if (exerciseIndex >= exerciseSet.length) {
    const result = completeLesson(db, userId, module, lessonId, {
      totalExercises: exerciseSet.length,
    });
    clearActiveSession(userId);

    // Update learner profile
    updateFromLessonCompletion(db, userId, module);

    const summary = buildSummaryEmbed(lesson, result.score, result.passed, result.totalCorrect, result.totalExercises);
    const components = buildLessonCompletionComponents(result.passed, lessonId);

    if (editMessage) {
      await interaction.update({ embeds: [summary], components });
    } else {
      await interaction.followUp({ embeds: [summary], components });
    }
    return;
  }

  const exercise = exerciseSet[exerciseIndex];
  const embed = buildExerciseEmbed(
    lesson,
    exerciseIndex,
    exercise,
    exerciseSet.length,
    exercisePromptForSession(session, exerciseIndex, exercise)
  );
  const buttons = buildExerciseButtons(exercise, lessonId, exerciseIndex, session);

  const expectsTypedAnswer = buttons.length === 0;
  if (expectsTypedAnswer) {
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
  handler: async (interaction, _ctx) => {
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
      if (!existing.selectedMode) {
        await interaction.reply({
          embeds: [buildIntroEmbed(existing.lesson)],
          components: buildModePickerComponents(existing.lesson),
        });
        return;
      }

      // Resume
      const exerciseSet = sessionExerciseSet(existing);
      const exercise = exerciseSet[existing.exerciseIndex];
      if (!exercise) {
        clearActiveSession(userId);
      } else {
        const embed = buildExerciseEmbed(
          existing.lesson,
          existing.exerciseIndex,
          exercise,
          exerciseSet.length,
          exercisePromptForSession(existing, existing.exerciseIndex, exercise)
        );
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

    let sessionExpired = false;
    const result = startLesson(db, userId, module, next.id);
    if (!result) {
      await interaction.reply({
        content: "Could not start lesson.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (result.resumeAt > 0) {
      db.startLesson(userId, module, next.id);
      result.resumeAt = 0;
      sessionExpired = true;
    }

    // Create active session
    setActiveLessonSession(userId, module, next.id, result.lesson, result.resumeAt);

    // Show intro
    const intro = buildIntroEmbed(result.lesson);
    const components = buildModePickerComponents(result.lesson);
    if (sessionExpired) {
      intro.addFields({
        name: "Session Restarted",
        value: "Your previous in-memory lesson session expired, so this lesson was reset safely.",
      });
    }

    await interaction.reply({ embeds: [intro], components });
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

registerButtonHandler("lesson", async (interaction, parts, _ctx) => {
  const action = parts[1];
  const userId = interaction.user.id;
  const db = getLessonDB();
  if (!db) return;

  if (action === "start") {
    // Legacy start button: default to the full mixed exercise set.
    const lessonId = parts[2];
    const session = activeSessions.get(userId);
    if (!lessonId || !session || session.lessonId !== lessonId) {
      await interaction.reply({
        content: "Session expired or no longer active. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (hasSelectedPracticeMode(session)) {
      await replyPracticeModeAlreadySelected(interaction);
      return;
    }
    selectSessionMode(session, "mixed");
    await sendNextExercise(interaction, session, true);
    return;
  }

  if (action === "mode") {
    const lessonId = parts[2];
    const mode = parsePracticeMode(parts[3]);
    const session = activeSessions.get(userId);
    if (!lessonId || !mode || !session || session.lessonId !== lessonId) {
      await interaction.reply({
        content: "Session expired or no longer active. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (hasSelectedPracticeMode(session)) {
      await replyPracticeModeAlreadySelected(interaction);
      return;
    }

    const availableModes = getAvailablePracticeModes(session.lesson);
    if (!availableModes.includes(mode)) {
      await interaction.reply({
        content: "That practice mode is not available for this lesson.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    selectSessionMode(session, mode);
    await sendNextExercise(interaction, session, true);
    return;
  }

  if (action === "answer") {
    // Button answer for recognition/MC exercises
    const lessonId = parts[2];
    const exerciseIndex = parseExerciseIndex(parts[3]);
    const answerToken = parts[4];
    const buttonBlankIndex = parts[5] === undefined ? null : parseExerciseIndex(parts[5]);

    if (
      !lessonId ||
      exerciseIndex === null ||
      answerToken === undefined ||
      (parts[5] !== undefined && buttonBlankIndex === null)
    ) {
      await interaction.reply({
        content: "That lesson button is invalid. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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

    const exerciseSet = sessionExerciseSet(session);
    const exercise = exerciseSet[exerciseIndex];
    if (!exercise) {
      await interaction.reply({
        content: "That exercise is no longer available. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const chartBlankIndex =
      isChartExercise(exercise)
        ? getChartProgress(session, exerciseIndex, exercise).currentBlankIndex
        : undefined;
    if (chartBlankIndex === undefined && buttonBlankIndex !== null) {
      await interaction.reply({
        content: "That lesson button is invalid. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      chartBlankIndex !== undefined &&
      buttonBlankIndex !== null &&
      buttonBlankIndex !== chartBlankIndex
    ) {
      await interaction.reply({
        content: "That chart blank is no longer active. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const userAnswer = session.answerOptionsByExercise
      .get(answerOptionsKey(exerciseIndex, chartBlankIndex))
      ?.get(answerToken);
    if (userAnswer === undefined) {
      await interaction.reply({
        content: "That answer option expired. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (isChartExercise(exercise)) {
      const progress = getChartProgress(session, exerciseIndex, exercise);
      const blankIndex = progress.currentBlankIndex;
      const blank = exercise.blanks[blankIndex];
      progress.filledAnswers[blankIndex] = userAnswer;
      progress.correctByBlank[blankIndex] = userAnswer === blank?.answer;
      session.answerOptionsByExercise.delete(answerOptionsKey(exerciseIndex, blankIndex));

      if (blankIndex < exercise.blanks.length - 1) {
        progress.currentBlankIndex++;
        const embed = buildExerciseEmbed(
          session.lesson,
          exerciseIndex,
          exercise,
          exerciseSet.length,
          exercisePromptForSession(session, exerciseIndex, exercise)
        );
        const buttons = buildExerciseButtons(exercise, lessonId, exerciseIndex, session);
        await interaction.update({ embeds: [embed], components: buttons });
        return;
      }

      const allCorrect = progress.correctByBlank.every(Boolean);
      db.saveExerciseResult(userId, session.module, lessonId, exerciseIndex, {
        index: exerciseIndex,
        exerciseType: exercise.type,
        correct: allCorrect,
        userAnswer: progress.filledAnswers
          .filter((answer): answer is string => answer !== null)
          .join(", "),
      });

      const progressRow = db.getProgress(userId, session.module, lessonId);
      const correctSoFar = progressRow?.exerciseResults.filter((r) => r.correct).length ?? 0;

      session.exerciseIndex = exerciseIndex + 1;
      session.chartProgressByExercise.delete(exerciseIndex);

      const resultEmbed = buildResultEmbed(
        allCorrect,
        allCorrect
          ? "✅ Chart complete!"
          : `❌ Chart complete. Expected: **${exercise.blanks.map((b) => b.answer).join(", ")}**`,
        correctSoFar,
        exerciseSet.length
      );

      await interaction.update({
        embeds: [resultEmbed],
        components: buildContinueComponents(lessonId),
      });
      return;
    }

    const result = scoreExercise(exercise, userAnswer, exerciseIndex);

    // Save to DB
    db.saveExerciseResult(userId, session.module, lessonId, exerciseIndex, {
      index: exerciseIndex,
      exerciseType: exercise.type,
      correct: result.correct,
      userAnswer,
    });

    // Count correct so far (progress already includes the just-saved result)
    const progress = db.getProgress(userId, session.module, lessonId);
    const correctSoFar = progress?.exerciseResults.filter((r) => r.correct).length ?? 0;

    // Move to next exercise
    session.exerciseIndex = exerciseIndex + 1;
    session.answerOptionsByExercise.delete(exerciseIndex);

    // Show result briefly then move on
    const resultEmbed = buildResultEmbed(
      result.correct,
      result.feedback,
      correctSoFar,
      exerciseSet.length
    );

    await interaction.update({
      embeds: [resultEmbed],
      components: buildContinueComponents(lessonId),
    });
    return;
  }

  if (action === "continue") {
    const lessonId = parts[2];
    const session = activeSessions.get(userId);
    if (!lessonId || !session || session.lessonId !== lessonId) {
      await interaction.reply({
        content: "Session expired or no longer active. Use `/lesson` to continue.",
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
    if (!result) {
      await interaction.reply({
        content: "Could not start the next lesson. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    setActiveLessonSession(userId, module, next.id, result.lesson, result.resumeAt);

    const intro = buildIntroEmbed(result.lesson);
    const components = buildModePickerComponents(result.lesson);

    await interaction.update({ embeds: [intro], components });
    return;
  }

  if (action === "retry") {
    const lessonId = parts[2];
    const module = getActiveModule(userId);
    if (!lessonId) {
      await interaction.reply({
        content: "That lesson retry button is invalid. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = startLesson(db, userId, module, lessonId);
    if (!result) {
      await interaction.reply({
        content: "That lesson is not available to retry. Use `/lesson` to continue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    setActiveLessonSession(userId, module, lessonId, result.lesson, 0);

    const intro = buildIntroEmbed(result.lesson);
    const components = buildModePickerComponents(result.lesson);

    await interaction.update({ embeds: [intro], components });
    return;
  }
});

// --- Handle typed answers for non-button exercises ---

/**
 * Called from plugin.onMessage when user has an active lesson session
 * and the current exercise requires typing.
 */
export function handleTypedAnswer(
  userId: string,
  text: string
): { result: ReturnType<typeof scoreExercise>; session: ActiveLessonSession } | null {
  const session = activeSessions.get(userId);
  if (!session) return null;

  const exercise = sessionExerciseSet(session)[session.exerciseIndex];
  if (!exercise) return null;

  if (!isTypingExercise(exercise)) return null;

  const db = getLessonDB();
  if (!db) return null;

  const result = scoreExercise(exercise, text, session.exerciseIndex);

  db.saveExerciseResult(userId, session.module, session.lessonId, session.exerciseIndex, {
    index: session.exerciseIndex,
    exerciseType: exercise.type,
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
  const exercise = sessionExerciseSet(session)[session.exerciseIndex];
  if (!exercise) return false;
  return isTypingExercise(exercise);
}

/** Get the active scored exercise set for a session. */
export function getSessionExerciseSet(session: ActiveLessonSession): Exercise[] {
  return sessionExerciseSet(session);
}

/** Get a prompt that reflects in-session state such as chart progress. */
export function getSessionExercisePrompt(
  session: ActiveLessonSession,
  exerciseIndex: number,
  exercise: Exercise
): string {
  return exercisePromptForSession(session, exerciseIndex, exercise);
}

/** Get active session for a user */
export function getActiveSession(userId: string): ActiveLessonSession | undefined {
  return activeSessions.get(userId);
}

/** Clear active session for a user */
export function clearActiveSession(userId: string): void {
  activeSessions.delete(userId);
}
