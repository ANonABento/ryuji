/**
 * Learner profile — auto-updated from lesson scores and SRS stats.
 * Deterministic, no LLM calls. Stored in lessons.db.
 */

import { nowUTC } from "@choomfie/shared";
import type { LessonDB } from "./lesson-db.ts";
import { getLesson, getAllLessons } from "./lesson-engine.ts";

function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

export interface LearnerProfile {
  userId: string;
  module: string;
  level: string;
  lessonsCompleted: number;
  totalLessons: number;
  avgScore: number;
  strongAreas: string[];
  weakAreas: string[];
  srsTotal: number;
  srsLearned: number;
  srsDue: number;
  totalStudyMins: number;
  streak: number;
  lastActive: string;
  preferredExerciseType: string;
  updatedAt: string;
}

const AVG_SESSION_MINS = 5;
const STRONG_SCORE_THRESHOLD = 0.9;
const WEAK_SCORE_THRESHOLD = 0.7;

/** Update profile after a lesson completion */
export function updateFromLessonCompletion(
  db: LessonDB,
  userId: string,
  module: string,
): void {
  const profile = db.getProfile(userId, module) ?? makeDefaultProfile(userId, module);
  const allProgress = db.getAllProgress(userId, module);
  const allLessons = getAllLessons(module);

  // Update lesson counts
  const completed = allProgress.filter((p) => p.status === "completed").length;
  profile.lessonsCompleted = completed;
  profile.totalLessons = allLessons.length;

  // Update avg score from all completed lessons
  const completedRows = allProgress.filter((p) => p.status === "completed" && p.score != null);
  if (completedRows.length > 0) {
    const totalScore = completedRows.reduce((sum, p) => sum + (p.score ?? 0), 0);
    profile.avgScore = Math.round((totalScore / completedRows.length) * 100) / 100;
  }

  // Compute strong/weak areas from completed lesson scores grouped by unit/skills
  const areaScores = new Map<string, { total: number; count: number }>();
  for (const row of completedRows) {
    const lesson = getLesson(module, row.lessonId);
    if (!lesson) continue;
    const areas = lesson.skillsTaught && lesson.skillsTaught.length > 0
      ? lesson.skillsTaught
      : [lesson.unit];
    for (const area of areas) {
      const existing = areaScores.get(area) ?? { total: 0, count: 0 };
      existing.total += row.score ?? 0;
      existing.count++;
      areaScores.set(area, existing);
    }
  }

  const strong: string[] = [];
  const weak: string[] = [];
  for (const [area, data] of areaScores) {
    const avg = data.total / data.count;
    if (avg > STRONG_SCORE_THRESHOLD) strong.push(area);
    else if (avg < WEAK_SCORE_THRESHOLD) weak.push(area);
  }
  profile.strongAreas = strong;
  profile.weakAreas = weak;

  // Update preferred exercise type from all exercise results
  profile.preferredExerciseType = computePreferredExerciseType(db, userId, module);

  // Update streak and lastActive
  updateStreak(profile);
  profile.lastActive = todayUTC();

  // Rough study time estimate
  profile.totalStudyMins = completed * AVG_SESSION_MINS;

  profile.updatedAt = nowUTC();
  db.upsertProfile(profile);
}

/** Update profile after an SRS review */
export function updateFromSrsReview(
  db: LessonDB,
  userId: string,
  module: string,
  srsStats: { total: number; learned: number; due: number }
): void {
  const profile = db.getProfile(userId, module) ?? makeDefaultProfile(userId, module);

  profile.srsTotal = srsStats.total;
  profile.srsLearned = srsStats.learned;
  profile.srsDue = srsStats.due;

  // Update streak and lastActive
  updateStreak(profile);
  profile.lastActive = todayUTC();

  profile.updatedAt = nowUTC();
  db.upsertProfile(profile);
}

/** Format profile as markdown for injection into tutor_prompt */
export function formatForPrompt(profile: LearnerProfile): string {
  const pct = Math.round(profile.avgScore * 100);
  const lines: string[] = [
    "## Learner Profile",
    `- Level: ${profile.level}`,
    `- Progress: ${profile.lessonsCompleted}/${profile.totalLessons} lessons completed (avg score: ${pct}%)`,
  ];

  if (profile.strongAreas.length > 0) {
    lines.push(`- Strong areas: ${profile.strongAreas.join(", ")}`);
  }
  if (profile.weakAreas.length > 0) {
    lines.push(`- Weak areas: ${profile.weakAreas.join(", ")}`);
  }

  if (profile.srsTotal > 0) {
    lines.push(
      `- SRS: ${profile.srsLearned}/${profile.srsTotal} learned, ${profile.srsDue} due for review`
    );
  }

  if (profile.streak > 0) {
    lines.push(`- Streak: ${profile.streak} day${profile.streak !== 1 ? "s" : ""}`);
  }

  if (profile.preferredExerciseType) {
    lines.push(`- Best exercise type: ${profile.preferredExerciseType}`);
  }

  return lines.join("\n");
}

// --- Internal helpers ---

function makeDefaultProfile(userId: string, module: string): LearnerProfile {
  return {
    userId,
    module,
    level: "N5",
    lessonsCompleted: 0,
    totalLessons: 0,
    avgScore: 0,
    strongAreas: [],
    weakAreas: [],
    srsTotal: 0,
    srsLearned: 0,
    srsDue: 0,
    totalStudyMins: 0,
    streak: 0,
    lastActive: "",
    preferredExerciseType: "",
    updatedAt: nowUTC(),
  };
}

function updateStreak(profile: LearnerProfile): void {
  const today = todayUTC();
  if (!profile.lastActive) {
    profile.streak = 1;
    return;
  }

  if (profile.lastActive === today) {
    // Already active today, no change
    return;
  }

  const lastDate = new Date(profile.lastActive + "T00:00:00Z");
  const todayDate = new Date(today + "T00:00:00Z");
  const diffDays = Math.round(
    (todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 1) {
    profile.streak++;
  } else {
    profile.streak = 1;
  }
}

function computePreferredExerciseType(
  db: LessonDB,
  userId: string,
  module: string
): string {
  const allProgress = db.getAllProgress(userId, module);
  const typeStats = new Map<string, { correct: number; total: number }>();

  for (const row of allProgress) {
    if (row.status !== "completed") continue;
    const lesson = getLesson(module, row.lessonId);
    if (!lesson) continue;

    for (const result of row.exerciseResults) {
      const exerciseType = result.exerciseType ?? lesson.exercises[result.index]?.type;
      if (!exerciseType) continue;

      const existing = typeStats.get(exerciseType) ?? { correct: 0, total: 0 };
      existing.total++;
      if (result.correct) existing.correct++;
      typeStats.set(exerciseType, existing);
    }
  }

  let best = "";
  let bestRate = -1;
  for (const [type, stats] of typeStats) {
    if (stats.total < 2) continue; // need minimum sample
    const rate = stats.correct / stats.total;
    if (rate > bestRate) {
      bestRate = rate;
      best = type;
    }
  }

  if (best) {
    return `${best} (${Math.round(bestRate * 100)}% accuracy)`;
  }
  return "";
}
