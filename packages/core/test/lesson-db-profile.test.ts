/**
 * Tests for learner_profiles table — round-trip via upsertProfile / getProfile.
 */
import { afterEach, expect, test, describe } from "bun:test";
import type { PluginContext } from "@choomfie/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LessonDB } from "../../../plugins/tutor/core/lesson-db.ts";
import { setLessonDB } from "../../../plugins/tutor/core/lesson-db-instance.ts";
import type { LearnerProfile } from "../../../plugins/tutor/core/learner-profile.ts";
import { srsTools } from "../../../plugins/tutor/tools/srs-tools.ts";

const tempDirs: string[] = [];
const emptyContext = {} as PluginContext;

function resultText(result: Awaited<ReturnType<(typeof srsTools)[number]["handler"]>>): string {
  return result.content[0]?.text ?? "";
}

afterEach(async () => {
  setLessonDB(null);
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {}))
  );
});

async function makeDB() {
  return (await makeDBWithPath()).db;
}

async function makeDBWithPath() {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-profile-"));
  tempDirs.push(dir);
  const path = join(dir, "lessons.db");
  return { db: new LessonDB(path), path };
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

  test("SRS reminder settings default to enabled and persist opt-out across reopen", async () => {
    const { db, path } = await makeDBWithPath();

    expect(db.getSrsReminderSettings("u1", "japanese")).toEqual({
      userId: "u1",
      module: "japanese",
      enabled: true,
      lastRemindedAt: 0,
    });

    db.setSrsRemindersEnabled("u1", "japanese", false);
    expect(db.getSrsReminderSettings("u1", "japanese").enabled).toBe(false);

    db.setSrsRemindersEnabled("u1", "japanese", true);
    expect(db.getSrsReminderSettings("u1", "japanese").enabled).toBe(true);
    db.setSrsRemindersEnabled("u1", "japanese", false);

    db.close();

    const reopened = new LessonDB(path);
    expect(reopened.getSrsReminderSettings("u1", "japanese").enabled).toBe(false);
    reopened.close();
  });

  test("recordSrsReminderSent persists cooldown across reopen without changing opt-out state", async () => {
    const { db, path } = await makeDBWithPath();

    db.setSrsRemindersEnabled("u1", "japanese", false);
    db.recordSrsReminderSent("u1", "japanese", 12345);

    const settings = db.getSrsReminderSettings("u1", "japanese");
    expect(settings.enabled).toBe(false);
    expect(settings.lastRemindedAt).toBe(12345);
    db.close();

    const reopened = new LessonDB(path);
    expect(reopened.getSrsReminderSettings("u1", "japanese")).toEqual({
      userId: "u1",
      module: "japanese",
      enabled: false,
      lastRemindedAt: 12345,
    });
    reopened.close();
  });

  test("srs_reminders tool reads and updates persisted preference", async () => {
    const db = await makeDB();
    setLessonDB(db);

    const tool = srsTools.find((t) => t.definition.name === "srs_reminders");
    expect(tool).toBeDefined();

    const disabled = await tool!.handler(
      { user_id: "u1", enabled: false },
      emptyContext
    );
    expect(resultText(disabled)).toContain("SRS reminders are **disabled** for japanese.");

    const status = await tool!.handler({ user_id: "u1" }, emptyContext);
    expect(resultText(status)).toContain("SRS reminders are **disabled** for japanese.");
    expect(db.getSrsReminderSettings("u1", "japanese").enabled).toBe(false);
    db.close();
  });
});
