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

  test("tutor plugin exports 12 tools", async () => {
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
    expect(names).toContain("random_word");
    expect(names.length).toBe(12);
  });

  test("socials plugin exports 33 tools", async () => {
    const mod = await import("@choomfie/socials");
    const plugin = mod.default;
    const names = (plugin.tools ?? []).map((t: any) => t.definition.name);
    expect(names).toEqual([
      "youtube_search",
      "youtube_info",
      "youtube_transcript",
      "youtube_auth",
      "youtube_comment",
      "reddit_search",
      "reddit_posts",
      "reddit_comments",
      "reddit_auth",
      "reddit_post",
      "reddit_comment",
      "linkedin_auth",
      "linkedin_post",
      "linkedin_post_image",
      "linkedin_post_images",
      "linkedin_post_link",
      "linkedin_edit",
      "linkedin_poll",
      "linkedin_repost",
      "linkedin_delete",
      "linkedin_comments",
      "linkedin_comment",
      "linkedin_react",
      "linkedin_schedule",
      "linkedin_queue",
      "linkedin_monitor",
      "linkedin_analytics",
      "linkedin_status",
      "twitter_auth",
      "twitter_post",
      "twitter_post_image",
      "twitter_thread",
      "twitter_status",
    ]);
  });
});
