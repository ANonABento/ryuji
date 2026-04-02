/**
 * Regression test — verifies all tools register correctly.
 * Checks tool count + names for each plugin.
 */
import { test, expect, describe } from "bun:test";

describe("plugin tool registration", () => {
  test("voice plugin exports 3 tools", async () => {
    const mod = await import("@choomfie/voice");
    const plugin = mod.default;
    const names = (plugin.tools ?? []).map((t: any) => t.definition.name);
    expect(names).toEqual(["join_voice", "leave_voice", "speak"]);
  });

  test("browser plugin exports 7 tools", async () => {
    const mod = await import("@choomfie/browser");
    const plugin = mod.default;
    const names = (plugin.tools ?? []).map((t: any) => t.definition.name);
    expect(names).toEqual([
      "browse",
      "browser_click",
      "browser_type",
      "browser_screenshot",
      "browser_eval",
      "browser_press_key",
      "browser_close",
    ]);
  });

  test("tutor plugin exports 11 tools", async () => {
    const mod = await import("@choomfie/tutor");
    const plugin = mod.default;
    const names = (plugin.tools ?? []).map((t: any) => t.definition.name);
    expect(names).toContain("tutor_prompt");
    expect(names).toContain("quiz");
    expect(names).toContain("dictionary_lookup");
    expect(names).toContain("set_level");
    expect(names).toContain("convert_kana");
    expect(names).toContain("list_modules");
    expect(names).toContain("switch_module");
    expect(names).toContain("srs_review");
    expect(names).toContain("srs_rate");
    expect(names).toContain("srs_stats");
    expect(names).toContain("lesson_status");
    expect(names.length).toBe(11);
  });

  test("socials plugin exports 28 tools", async () => {
    const mod = await import("@choomfie/socials");
    const plugin = mod.default;
    const names = (plugin.tools ?? []).map((t: any) => t.definition.name);
    expect(names).toContain("youtube_search");
    expect(names).toContain("youtube_info");
    expect(names).toContain("youtube_transcript");
    expect(names).toContain("youtube_auth");
    expect(names).toContain("youtube_comment");
    expect(names).toContain("reddit_search");
    expect(names).toContain("reddit_posts");
    expect(names).toContain("reddit_comments");
    expect(names).toContain("reddit_auth");
    expect(names).toContain("reddit_post");
    expect(names).toContain("reddit_comment");
    expect(names).toContain("linkedin_auth");
    expect(names).toContain("linkedin_post");
    expect(names).toContain("linkedin_status");
    expect(names.length).toBe(28);
  });
});
