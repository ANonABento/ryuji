/**
 * Tests for learner-profile module — pure logic against an in-tmpdir DB.
 */
import { afterEach, beforeEach, expect, test, describe } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LessonDB } from "../../../plugins/tutor/core/lesson-db.ts";
import {
  formatForPrompt,
  updateFromLessonCompletion,
  updateFromSrsReview,
  type LearnerProfile,
} from "../../../plugins/tutor/core/learner-profile.ts";
import { registerLessons } from "../../../plugins/tutor/core/lesson-engine.ts";
import type { Lesson } from "../../../plugins/tutor/core/lesson-types.ts";

const tempDirs: string[] = [];

function makeLesson(id: string, unit: string, skill: string): Lesson {
  return {
    id,
    unit,
    unitIndex: 1,
    title: `Lesson ${id}`,
    prerequisites: [],
    introduction: { text: "intro" },
    exercises: [
      { type: "recognition", prompt: "?", answer: "a", distractors: ["b", "c"] },
      { type: "recognition", prompt: "?", answer: "b", distractors: ["a", "c"] },
    ],
    skillsTaught: [skill],
  };
}

const SAMPLE_LESSONS: Lesson[] = [
  makeLesson("1.1", "hiragana", "vowels"),
  makeLesson("1.2", "hiragana", "k_row"),
  makeLesson("1.3", "hiragana", "s_row"),
];

beforeEach(() => {
  registerLessons("test-module", SAMPLE_LESSONS, []);
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {}))
  );
});

async function makeDB() {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-lp-"));
  tempDirs.push(dir);
  return new LessonDB(join(dir, "lessons.db"));
}

function completeLessonInDb(
  db: LessonDB,
  userId: string,
  module: string,
  lessonId: string,
  score: number,
  exerciseCount: number = 2
) {
  db.startLesson(userId, module, lessonId);
  for (let i = 0; i < exerciseCount; i++) {
    const correct = i < Math.round(exerciseCount * score);
    db.saveExerciseResult(userId, module, lessonId, i, {
      index: i,
      correct,
      userAnswer: "x",
    });
  }
  db.completeLesson(userId, module, lessonId, score);
}

describe("updateFromLessonCompletion", () => {
  test("creates a profile row on first completion", async () => {
    const db = await makeDB();
    completeLessonInDb(db, "u1", "test-module", "1.1", 1.0);
    updateFromLessonCompletion(db, "u1", "test-module");

    const p = db.getProfile("u1", "test-module");
    expect(p).not.toBeNull();
    expect(p!.lessonsCompleted).toBe(1);
    expect(p!.totalLessons).toBe(SAMPLE_LESSONS.length);
    expect(p!.streak).toBe(1);
    db.close();
  });

  test("strong areas appear when avg score > 0.9 in a skill", async () => {
    const db = await makeDB();
    completeLessonInDb(db, "u1", "test-module", "1.1", 0.95);
    updateFromLessonCompletion(db, "u1", "test-module");

    const p = db.getProfile("u1", "test-module")!;
    expect(p.strongAreas).toContain("vowels");
    expect(p.weakAreas).not.toContain("vowels");
    db.close();
  });

  test("weak areas appear when avg score < 0.7 in a skill", async () => {
    const db = await makeDB();
    completeLessonInDb(db, "u1", "test-module", "1.2", 0.6);
    updateFromLessonCompletion(db, "u1", "test-module");

    const p = db.getProfile("u1", "test-module")!;
    expect(p.weakAreas).toContain("k_row");
    expect(p.strongAreas).not.toContain("k_row");
    db.close();
  });

  test("avg score is recomputed across all completed lessons", async () => {
    const db = await makeDB();
    completeLessonInDb(db, "u1", "test-module", "1.1", 1.0);
    updateFromLessonCompletion(db, "u1", "test-module");

    completeLessonInDb(db, "u1", "test-module", "1.2", 0.5);
    updateFromLessonCompletion(db, "u1", "test-module");

    const p = db.getProfile("u1", "test-module")!;
    expect(p.avgScore).toBeCloseTo(0.75, 2);
    expect(p.lessonsCompleted).toBe(2);
    db.close();
  });
});

describe("streak math", () => {
  test("first activity sets streak to 1", async () => {
    const db = await makeDB();
    completeLessonInDb(db, "u1", "test-module", "1.1", 1);
    updateFromLessonCompletion(db, "u1", "test-module");
    expect(db.getProfile("u1", "test-module")!.streak).toBe(1);
    db.close();
  });

  test("same-day double activity does not increment streak", async () => {
    const db = await makeDB();
    completeLessonInDb(db, "u1", "test-module", "1.1", 1);
    updateFromLessonCompletion(db, "u1", "test-module");

    completeLessonInDb(db, "u1", "test-module", "1.2", 1);
    updateFromLessonCompletion(db, "u1", "test-module");

    expect(db.getProfile("u1", "test-module")!.streak).toBe(1);
    db.close();
  });

  test("yesterday → +1 streak", async () => {
    const db = await makeDB();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const profile: LearnerProfile = {
      userId: "u1",
      module: "test-module",
      level: "N5",
      lessonsCompleted: 1,
      totalLessons: 3,
      avgScore: 1,
      strongAreas: [],
      weakAreas: [],
      srsTotal: 0,
      srsLearned: 0,
      srsDue: 0,
      totalStudyMins: 5,
      streak: 3,
      lastActive: yesterday,
      preferredExerciseType: "",
      updatedAt: "2026-04-23 12:00:00",
    };
    db.upsertProfile(profile);

    completeLessonInDb(db, "u1", "test-module", "1.1", 1);
    updateFromLessonCompletion(db, "u1", "test-module");

    expect(db.getProfile("u1", "test-module")!.streak).toBe(4);
    db.close();
  });

  test("2-day gap resets streak to 1", async () => {
    const db = await makeDB();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    db.upsertProfile({
      userId: "u1",
      module: "test-module",
      level: "N5",
      lessonsCompleted: 1,
      totalLessons: 3,
      avgScore: 1,
      strongAreas: [],
      weakAreas: [],
      srsTotal: 0,
      srsLearned: 0,
      srsDue: 0,
      totalStudyMins: 0,
      streak: 9,
      lastActive: twoDaysAgo,
      preferredExerciseType: "",
      updatedAt: "2026-04-22 12:00:00",
    });

    completeLessonInDb(db, "u1", "test-module", "1.1", 1);
    updateFromLessonCompletion(db, "u1", "test-module");

    expect(db.getProfile("u1", "test-module")!.streak).toBe(1);
    db.close();
  });
});

describe("updateFromSrsReview", () => {
  test("writes srs counts and updates streak", async () => {
    const db = await makeDB();
    updateFromSrsReview(db, "u1", "test-module", { total: 50, learned: 12, due: 3 });

    const p = db.getProfile("u1", "test-module")!;
    expect(p.srsTotal).toBe(50);
    expect(p.srsLearned).toBe(12);
    expect(p.srsDue).toBe(3);
    expect(p.streak).toBe(1);
    db.close();
  });
});

describe("formatForPrompt", () => {
  test("includes only sections with data", () => {
    const empty: LearnerProfile = {
      userId: "u1",
      module: "japanese",
      level: "N5",
      lessonsCompleted: 0,
      totalLessons: 32,
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
      updatedAt: "2026-04-24 12:00:00",
    };
    const out = formatForPrompt(empty);
    expect(out).toContain("## Learner Profile");
    expect(out).toContain("Level: N5");
    expect(out).not.toContain("Strong areas");
    expect(out).not.toContain("Weak areas");
    expect(out).not.toContain("SRS");
    expect(out).not.toContain("Streak");
  });

  test("includes all sections when populated", () => {
    const full: LearnerProfile = {
      userId: "u1",
      module: "japanese",
      level: "N5",
      lessonsCompleted: 5,
      totalLessons: 32,
      avgScore: 0.92,
      strongAreas: ["vowels", "k_row"],
      weakAreas: ["s_row"],
      srsTotal: 100,
      srsLearned: 30,
      srsDue: 8,
      totalStudyMins: 25,
      streak: 5,
      lastActive: "2026-04-24",
      preferredExerciseType: "recognition (95% accuracy)",
      updatedAt: "2026-04-24 12:00:00",
    };
    const out = formatForPrompt(full);
    expect(out).toContain("Strong areas: vowels, k_row");
    expect(out).toContain("Weak areas: s_row");
    expect(out).toContain("SRS: 30/100 learned, 8 due");
    expect(out).toContain("Streak: 5 days");
    expect(out).toContain("Best exercise type: recognition (95% accuracy)");
  });
});
