/**
 * Lesson progress persistence — SQLite-backed per-user lesson state.
 *
 * Uses the same DB file as SRS (srs.db) for simplicity.
 */

import { Database } from "bun:sqlite";
import { nowUTC } from "@choomfie/shared";
import type { ExerciseResult, LessonStatus } from "./lesson-types.ts";
import type { LearnerProfile } from "./learner-profile.ts";

export interface LessonProgressRow {
  userId: string;
  module: string;
  lessonId: string;
  status: LessonStatus;
  score: number | null;
  attempts: number;
  currentExercise: number;
  exerciseResults: ExerciseResult[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface SrsReminderSettings {
  userId: string;
  module: string;
  enabled: boolean;
  lastRemindedAt: number;
}

interface LessonProgressDBRow {
  user_id: string;
  module: string;
  lesson_id: string;
  status: LessonStatus;
  score: number | null;
  attempts: number;
  current_exercise: number;
  exercise_results: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface LearnerProfileDBRow {
  user_id: string;
  module: string;
  level: string;
  lessons_completed: number;
  total_lessons: number;
  avg_score: number;
  strong_areas: string | null;
  weak_areas: string | null;
  srs_total: number;
  srs_learned: number;
  srs_due: number;
  total_study_mins: number;
  streak: number;
  last_active: string;
  preferred_exercise_type: string;
  updated_at: string;
}

interface SrsReminderSettingsDBRow {
  user_id: string;
  module: string;
  enabled: number;
  last_reminded_at: number | null;
}

interface CountDBRow {
  c: number;
}

interface StatusCountDBRow {
  status: LessonStatus;
  c: number;
}

export class LessonDB {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lesson_progress (
        user_id TEXT NOT NULL,
        module TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        status TEXT DEFAULT 'locked',
        score REAL,
        attempts INTEGER DEFAULT 0,
        current_exercise INTEGER DEFAULT 0,
        exercise_results TEXT DEFAULT '[]',
        started_at TEXT,
        completed_at TEXT,
        PRIMARY KEY (user_id, module, lesson_id)
      );

      CREATE INDEX IF NOT EXISTS idx_lesson_user_module
        ON lesson_progress(user_id, module);

      CREATE TABLE IF NOT EXISTS learner_profiles (
        user_id TEXT NOT NULL,
        module TEXT NOT NULL,
        level TEXT DEFAULT 'N5',
        lessons_completed INTEGER DEFAULT 0,
        total_lessons INTEGER DEFAULT 0,
        avg_score REAL DEFAULT 0,
        strong_areas TEXT DEFAULT '[]',
        weak_areas TEXT DEFAULT '[]',
        srs_total INTEGER DEFAULT 0,
        srs_learned INTEGER DEFAULT 0,
        srs_due INTEGER DEFAULT 0,
        total_study_mins INTEGER DEFAULT 0,
        streak INTEGER DEFAULT 0,
        last_active TEXT DEFAULT '',
        preferred_exercise_type TEXT DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, module)
      );

      CREATE TABLE IF NOT EXISTS srs_reminder_settings (
        user_id TEXT NOT NULL,
        module TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        last_reminded_at INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, module)
      );
    `);
  }

  /** Get progress for a specific lesson */
  getProgress(userId: string, module: string, lessonId: string): LessonProgressRow | null {
    const row = this.db
      .query("SELECT * FROM lesson_progress WHERE user_id = ? AND module = ? AND lesson_id = ?")
      .get(userId, module, lessonId) as LessonProgressDBRow | null;
    return row ? this.rowToProgress(row) : null;
  }

  /** Get all progress for a user+module */
  getAllProgress(userId: string, module: string): LessonProgressRow[] {
    const rows = this.db
      .query("SELECT * FROM lesson_progress WHERE user_id = ? AND module = ? ORDER BY lesson_id")
      .all(userId, module) as LessonProgressDBRow[];
    return rows.map(this.rowToProgress);
  }

  /** Ensure a lesson row exists (idempotent) */
  ensureLesson(userId: string, module: string, lessonId: string, status: LessonStatus = "locked") {
    this.db
      .query(
        `INSERT OR IGNORE INTO lesson_progress (user_id, module, lesson_id, status)
         VALUES (?, ?, ?, ?)`
      )
      .run(userId, module, lessonId, status);
  }

  /** Set lesson status */
  setStatus(userId: string, module: string, lessonId: string, status: LessonStatus) {
    this.ensureLesson(userId, module, lessonId);
    this.db
      .query("UPDATE lesson_progress SET status = ? WHERE user_id = ? AND module = ? AND lesson_id = ?")
      .run(status, userId, module, lessonId);
  }

  /** Start a lesson (set in_progress, record start time, increment attempts) */
  startLesson(userId: string, module: string, lessonId: string) {
    this.ensureLesson(userId, module, lessonId);
    this.db
      .query(
        `UPDATE lesson_progress
         SET status = 'in_progress', started_at = ?, current_exercise = 0,
             exercise_results = '[]', attempts = attempts + 1
         WHERE user_id = ? AND module = ? AND lesson_id = ?`
      )
      .run(nowUTC(), userId, module, lessonId);
  }

  /** Save exercise result mid-lesson */
  saveExerciseResult(
    userId: string,
    module: string,
    lessonId: string,
    exerciseIndex: number,
    result: ExerciseResult
  ) {
    const progress = this.getProgress(userId, module, lessonId);
    if (!progress) return;

    const results = [...progress.exerciseResults, result];
    this.db
      .query(
        `UPDATE lesson_progress
         SET current_exercise = ?, exercise_results = ?
         WHERE user_id = ? AND module = ? AND lesson_id = ?`
      )
      .run(exerciseIndex + 1, JSON.stringify(results), userId, module, lessonId);
  }

  /** Complete a lesson with final score */
  completeLesson(userId: string, module: string, lessonId: string, score: number) {
    this.db
      .query(
        `UPDATE lesson_progress
         SET status = 'completed', score = ?, completed_at = ?
         WHERE user_id = ? AND module = ? AND lesson_id = ?`
      )
      .run(score, nowUTC(), userId, module, lessonId);
  }

  /** Count completed lessons for a user+module */
  completedCount(userId: string, module: string): number {
    const row = this.db
      .query(
        "SELECT COUNT(*) as c FROM lesson_progress WHERE user_id = ? AND module = ? AND status = 'completed'"
      )
      .get(userId, module) as CountDBRow | null;
    return row?.c ?? 0;
  }

  /** Get stats for progress display */
  getStats(userId: string, module: string): { completed: number; inProgress: number; total: number } {
    const rows = this.db
      .query(
        `SELECT status, COUNT(*) as c FROM lesson_progress
         WHERE user_id = ? AND module = ?
         GROUP BY status`
      )
      .all(userId, module) as StatusCountDBRow[];

    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      counts[row.status] = row.c;
      total += row.c;
    }
    return {
      completed: counts["completed"] ?? 0,
      inProgress: counts["in_progress"] ?? 0,
      total,
    };
  }

  /** Get learner profile for a user+module */
  getProfile(userId: string, module: string): LearnerProfile | null {
    const row = this.db
      .query("SELECT * FROM learner_profiles WHERE user_id = ? AND module = ?")
      .get(userId, module) as LearnerProfileDBRow | null;
    return row ? this.rowToProfile(row) : null;
  }

  /** Insert or update a learner profile */
  upsertProfile(profile: LearnerProfile): void {
    this.db
      .query(
        `INSERT INTO learner_profiles
           (user_id, module, level, lessons_completed, total_lessons, avg_score,
            strong_areas, weak_areas, srs_total, srs_learned, srs_due,
            total_study_mins, streak, last_active, preferred_exercise_type, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, module) DO UPDATE SET
           level = excluded.level,
           lessons_completed = excluded.lessons_completed,
           total_lessons = excluded.total_lessons,
           avg_score = excluded.avg_score,
           strong_areas = excluded.strong_areas,
           weak_areas = excluded.weak_areas,
           srs_total = excluded.srs_total,
           srs_learned = excluded.srs_learned,
           srs_due = excluded.srs_due,
           total_study_mins = excluded.total_study_mins,
           streak = excluded.streak,
           last_active = excluded.last_active,
           preferred_exercise_type = excluded.preferred_exercise_type,
           updated_at = excluded.updated_at`
      )
      .run(
        profile.userId,
        profile.module,
        profile.level,
        profile.lessonsCompleted,
        profile.totalLessons,
        profile.avgScore,
        JSON.stringify(profile.strongAreas),
        JSON.stringify(profile.weakAreas),
        profile.srsTotal,
        profile.srsLearned,
        profile.srsDue,
        profile.totalStudyMins,
        profile.streak,
        profile.lastActive,
        profile.preferredExerciseType,
        profile.updatedAt
      );
  }

  /** Read SRS reminder settings, defaulting to enabled with no cooldown. */
  getSrsReminderSettings(userId: string, module: string): SrsReminderSettings {
    const row = this.db
      .query(
        `SELECT user_id, module, enabled, last_reminded_at
         FROM srs_reminder_settings
         WHERE user_id = ? AND module = ?`
      )
      .get(userId, module) as SrsReminderSettingsDBRow | null;

    if (!row) {
      return { userId, module, enabled: true, lastRemindedAt: 0 };
    }

    return {
      userId: row.user_id,
      module: row.module,
      enabled: row.enabled !== 0,
      lastRemindedAt: row.last_reminded_at ?? 0,
    };
  }

  /** Enable or disable SRS reminders for a user/module pair. */
  setSrsRemindersEnabled(userId: string, module: string, enabled: boolean): void {
    this.db
      .query(
        `INSERT INTO srs_reminder_settings
           (user_id, module, enabled, last_reminded_at, updated_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(user_id, module) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(userId, module, enabled ? 1 : 0, nowUTC());
  }

  /** Persist the latest sent reminder time without changing opt-out state. */
  recordSrsReminderSent(userId: string, module: string, remindedAt: number = Date.now()): void {
    this.db
      .query(
        `INSERT INTO srs_reminder_settings
           (user_id, module, enabled, last_reminded_at, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(user_id, module) DO UPDATE SET
           last_reminded_at = excluded.last_reminded_at,
           updated_at = excluded.updated_at`
      )
      .run(userId, module, remindedAt, nowUTC());
  }

  close() {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {}
    this.db.close();
  }

  private rowToProfile(row: LearnerProfileDBRow): LearnerProfile {
    return {
      userId: row.user_id,
      module: row.module,
      level: row.level,
      lessonsCompleted: row.lessons_completed,
      totalLessons: row.total_lessons,
      avgScore: row.avg_score,
      strongAreas: JSON.parse(row.strong_areas || "[]"),
      weakAreas: JSON.parse(row.weak_areas || "[]"),
      srsTotal: row.srs_total,
      srsLearned: row.srs_learned,
      srsDue: row.srs_due,
      totalStudyMins: row.total_study_mins,
      streak: row.streak,
      lastActive: row.last_active,
      preferredExerciseType: row.preferred_exercise_type,
      updatedAt: row.updated_at,
    };
  }

  private rowToProgress(row: LessonProgressDBRow): LessonProgressRow {
    return {
      userId: row.user_id,
      module: row.module,
      lessonId: row.lesson_id,
      status: row.status as LessonStatus,
      score: row.score,
      attempts: row.attempts,
      currentExercise: row.current_exercise,
      exerciseResults: JSON.parse(row.exercise_results || "[]"),
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }
}
