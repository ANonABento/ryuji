/**
 * Tests for learner_profiles table — round-trip via upsertProfile / getProfile.
 */
import { afterEach, expect, test, describe } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LessonDB } from "../../../plugins/tutor/core/lesson-db.ts";
import type { LearnerProfile } from "../../../plugins/tutor/core/learner-profile.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {}))
  );
});

async function makeDB() {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-profile-"));
  tempDirs.push(dir);
  return new LessonDB(join(dir, "lessons.db"));
}

function sampleProfile(userId = "u1", module = "japanese"): LearnerProfile {
  return {
    userId,
    module,
    level: "N5",
    lessonsCompleted: 3,
    totalLessons: 32,
    avgScore: 0.92,
    strongAreas: ["hiragana_vowels", "hiragana_k"],
    weakAreas: ["hiragana_h"],
    srsTotal: 50,
    srsLearned: 10,
    srsDue: 5,
    totalStudyMins: 15,
    streak: 4,
    lastActive: "2026-04-23",
    preferredExerciseType: "recognition (95% accuracy)",
    updatedAt: "2026-04-24 12:00:00",
  };
}

describe("LessonDB.learner_profiles", () => {
  test("getProfile returns null when no row exists", async () => {
    const db = await makeDB();
    expect(db.getProfile("nobody", "japanese")).toBeNull();
    db.close();
  });

  test("upsertProfile + getProfile round-trips JSON arrays", async () => {
    const db = await makeDB();
    const p = sampleProfile();
    db.upsertProfile(p);

    const fetched = db.getProfile(p.userId, p.module);
    expect(fetched).not.toBeNull();
    expect(fetched!.strongAreas).toEqual(p.strongAreas);
    expect(fetched!.weakAreas).toEqual(p.weakAreas);
    expect(fetched!.lessonsCompleted).toBe(3);
    expect(fetched!.avgScore).toBeCloseTo(0.92);
    expect(fetched!.streak).toBe(4);
    db.close();
  });

  test("second upsert overwrites existing row (PRIMARY KEY user_id+module)", async () => {
    const db = await makeDB();
    db.upsertProfile(sampleProfile());

    const updated: LearnerProfile = {
      ...sampleProfile(),
      lessonsCompleted: 10,
      strongAreas: ["greetings"],
      weakAreas: [],
      streak: 12,
    };
    db.upsertProfile(updated);

    const fetched = db.getProfile(updated.userId, updated.module);
    expect(fetched!.lessonsCompleted).toBe(10);
    expect(fetched!.strongAreas).toEqual(["greetings"]);
    expect(fetched!.weakAreas).toEqual([]);
    expect(fetched!.streak).toBe(12);
    db.close();
  });

  test("profile is keyed per (user, module) — two modules coexist", async () => {
    const db = await makeDB();
    db.upsertProfile(sampleProfile("u1", "japanese"));
    db.upsertProfile({ ...sampleProfile("u1", "spanish"), lessonsCompleted: 7 });

    expect(db.getProfile("u1", "japanese")!.lessonsCompleted).toBe(3);
    expect(db.getProfile("u1", "spanish")!.lessonsCompleted).toBe(7);
    db.close();
  });

  test("reopening DB does not error (idempotent migration)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "choomfie-profile-"));
    tempDirs.push(dir);
    const path = join(dir, "lessons.db");

    const db1 = new LessonDB(path);
    db1.upsertProfile(sampleProfile());
    db1.close();

    const db2 = new LessonDB(path);
    expect(db2.getProfile("u1", "japanese")!.lessonsCompleted).toBe(3);
    db2.close();
  });
});
