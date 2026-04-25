/**
 * Tests for tutor prompt context, including active lesson furigana guidance.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { commands } from "@choomfie/shared";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LessonDB } from "../../../plugins/tutor/core/lesson-db.ts";
import { setLessonDB } from "../../../plugins/tutor/core/lesson-db-instance.ts";
import { registerLessons } from "../../../plugins/tutor/core/lesson-engine.ts";
import { japaneseModule } from "../../../plugins/tutor/modules/japanese/index.ts";
import { japaneseLessons, japaneseUnits } from "../../../plugins/tutor/modules/japanese/lessons/index.ts";
import { tutorTools } from "../../../plugins/tutor/tools/tutor-tools.ts";
import "../../../plugins/tutor/lesson-interactions.ts";

const tempDirs: string[] = [];
const openDbs: LessonDB[] = [];

function promptText(result: Awaited<ReturnType<(typeof tutorTools)[number]["handler"]>>): string {
  return result.content[0]?.text ?? "";
}

async function makeDB(): Promise<LessonDB> {
  const dir = await mkdtemp(join(tmpdir(), "choomfie-tutor-prompt-"));
  tempDirs.push(dir);
  const db = new LessonDB(join(dir, "lessons.db"));
  openDbs.push(db);
  return db;
}

beforeEach(() => {
  registerLessons("japanese", japaneseLessons, japaneseUnits);
});

afterEach(async () => {
  setLessonDB(null);
  for (const db of openDbs.splice(0)) {
    db.close();
  }
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {}))
  );
});

describe("Japanese tutor prompt", () => {
  test("keeps the default N5 prompt shape when no lesson context exists", () => {
    const prompt = japaneseModule.buildTutorPrompt!("N5");

    expect(prompt).toContain("You are a Japanese language tutor.");
    expect(prompt).toContain("Student is a COMPLETE BEGINNER (JLPT N5).");
    expect(prompt).toContain('"response_jp"');
    expect(prompt).not.toContain("Furigana: ALWAYS show readings for every kanji");
    expect(prompt).not.toContain("Furigana: only show readings for uncommon kanji");
    expect(prompt).not.toContain("Furigana: do not add furigana");
  });

  test("appends full furigana guidance after the generic level guide", () => {
    const prompt = japaneseModule.buildTutorPrompt!("N5", { furiganaLevel: "full" });

    expect(prompt).toContain("Furigana: ALWAYS show readings for every kanji");
    expect(prompt.indexOf("Furigana: ALWAYS show readings for every kanji")).toBeGreaterThan(
      prompt.indexOf("Student is a COMPLETE BEGINNER (JLPT N5).")
    );
  });

  test("appends partial furigana guidance as the final lesson-specific directive", () => {
    const prompt = japaneseModule.buildTutorPrompt!("N5", { furiganaLevel: "partial" });

    expect(prompt).toContain("Furigana: only show readings for uncommon kanji");
    expect(prompt).not.toContain("Furigana: do not add furigana");
    expect(prompt.indexOf("Furigana: only show readings for uncommon kanji")).toBeGreaterThan(
      prompt.indexOf("Always include furigana for kanji")
    );
  });

  test("appends no-furigana guidance after the generic level guide", () => {
    const prompt = japaneseModule.buildTutorPrompt!("N5", { furiganaLevel: "none" });

    expect(prompt).toContain("Furigana: do not add furigana");
    expect(prompt.indexOf("Furigana: do not add furigana")).toBeGreaterThan(
      prompt.indexOf("Always include furigana for kanji")
    );
  });
});

describe("tutor_prompt tool", () => {
  test("uses the active lesson furigana level when a lesson session exists", async () => {
    const db = await makeDB();
    setLessonDB(db);

    const lessonCommand = commands.get("lesson");
    expect(lessonCommand).toBeDefined();

    const userId = "prompt-active-lesson-user";
    await lessonCommand!.handler(
      {
        user: { id: userId },
        reply: async () => {},
      } as any,
      {} as any
    );

    const tool = tutorTools.find((t) => t.definition.name === "tutor_prompt");
    expect(tool).toBeDefined();

    const result = await tool!.handler({ user_id: userId }, {} as any);
    const prompt = promptText(result);

    expect(prompt).toContain("Furigana: ALWAYS show readings for every kanji");
  });
});
