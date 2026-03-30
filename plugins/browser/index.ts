/**
 * Browser plugin — web browsing via Playwright.
 *
 * Provides headless Chromium browsing: navigate, read page content via
 * accessibility snapshots, click/type by element ref, take screenshots,
 * and evaluate JavaScript. Sessions persist until closed.
 */

import type { Plugin } from "../../lib/types.ts";
import { browserTools } from "./tools.ts";
import { closeAll } from "./session.ts";

const browserPlugin: Plugin = {
  name: "browser",

  tools: browserTools,

  instructions: [
    "## Browser",
    "You can browse the web using Playwright.",
    'Use `browse` to navigate to a URL — it returns an accessibility tree with element refs.',
    'Use refs (e.g. "link:Sign in", "button:Submit") from the snapshot to click or type into elements.',
    "Use `browser_screenshot` to capture visual state (returns a file path you can attach to Discord messages).",
    'Sessions persist — use named sessions (e.g. session="facebook") to keep multiple pages open.',
    "The browser runs headless by default.",
  ],

  userTools: [
    "browse",
    "browser_click",
    "browser_type",
    "browser_screenshot",
    "browser_eval",
    "browser_press_key",
    "browser_close",
  ],

  async init() {
    console.error("Browser plugin initialized");
  },

  async destroy() {
    await closeAll();
    console.error("Browser plugin destroyed — all sessions closed");
  },
};

export default browserPlugin;
