/**
 * Browser session manager — launches and manages Playwright browser instances.
 *
 * Each session is a named browser context with one page.
 * Sessions persist until explicitly closed or plugin destroyed.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

const SCREENSHOT_DIR = join(
  process.env.HOME ?? "/tmp",
  ".claude/plugins/data/choomfie-inline/browser/screenshots"
);

interface Session {
  context: BrowserContext;
  page: Page;
}

let browser: Browser | null = null;
const sessions = new Map<string, Session>();

/** Ensure browser is launched. */
async function ensureBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({ headless: true });
  return browser;
}

/** Get or create a named session. */
async function getSession(name: string): Promise<Session> {
  const existing = sessions.get(name);
  if (existing && !existing.page.isClosed()) return existing;

  // Clean up stale session entry
  if (existing) sessions.delete(name);

  const b = await ensureBrowser();
  const context = await b.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const session: Session = { context, page };
  sessions.set(name, session);
  return session;
}

/** Navigate to URL, return page info + accessibility snapshot. */
export async function browse(
  sessionName: string,
  url: string
): Promise<string> {
  const { page } = await getSession(sessionName);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Wait a bit for dynamic content
  await page.waitForTimeout(1000);
  return await snapshot(sessionName);
}

/** Get accessibility tree snapshot of current page. */
export async function snapshot(sessionName: string): Promise<string> {
  const session = sessions.get(sessionName);
  if (!session || session.page.isClosed()) {
    throw new Error("No browser open. Use `browse` to open a page first.");
  }
  const { page } = session;
  const title = await page.title();
  const url = page.url();

  // Use Playwright's ariaSnapshot (YAML accessibility tree)
  const ariaYaml = await page
    .locator(":root")
    .ariaSnapshot({ timeout: 10_000 });

  return `# ${title}\nURL: ${url}\n\n${ariaYaml}`;
}

/** Click an element by its accessibility ref (role + name combo or index). */
export async function click(
  sessionName: string,
  ref: string
): Promise<string> {
  const session = sessions.get(sessionName);
  if (!session || session.page.isClosed()) {
    throw new Error("No browser open. Use `browse` to open a page first.");
  }
  const { page } = session;

  // Try to find and click element by role/name from accessibility tree
  const locator = resolveRef(page, ref);
  await locator.click({ timeout: 10_000 });

  // Return updated snapshot after click
  await page.waitForTimeout(500);
  return await snapshot(sessionName);
}

/** Type text into the focused element or a specified element. */
export async function type(
  sessionName: string,
  text: string,
  ref?: string
): Promise<string> {
  const session = sessions.get(sessionName);
  if (!session || session.page.isClosed()) {
    throw new Error("No browser open. Use `browse` to open a page first.");
  }
  const { page } = session;

  if (ref) {
    const locator = resolveRef(page, ref);
    await locator.fill(text, { timeout: 10_000 });
  } else {
    await page.keyboard.type(text);
  }

  await page.waitForTimeout(300);
  return await snapshot(sessionName);
}

/** Press a keyboard key. */
export async function pressKey(
  sessionName: string,
  key: string
): Promise<string> {
  const session = sessions.get(sessionName);
  if (!session || session.page.isClosed()) {
    throw new Error("No browser open. Use `browse` to open a page first.");
  }
  await session.page.keyboard.press(key);
  await session.page.waitForTimeout(500);
  return await snapshot(sessionName);
}

/** Take a screenshot, return file path. */
export async function screenshot(sessionName: string): Promise<string> {
  const session = sessions.get(sessionName);
  if (!session || session.page.isClosed()) {
    throw new Error("No browser open. Use `browse` to open a page first.");
  }

  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const filename = `${sessionName}-${Date.now()}.png`;
  const filePath = join(SCREENSHOT_DIR, filename);
  await session.page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

/** Evaluate JavaScript on the page. */
export async function evaluate(
  sessionName: string,
  code: string
): Promise<string> {
  const session = sessions.get(sessionName);
  if (!session || session.page.isClosed()) {
    throw new Error("No browser open. Use `browse` to open a page first.");
  }

  const result = await session.page.evaluate(code);
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

/** Close a specific session. */
export async function closeSession(sessionName: string): Promise<void> {
  const session = sessions.get(sessionName);
  if (session) {
    await session.context.close().catch(() => {});
    sessions.delete(sessionName);
  }
}

/** Close all sessions and the browser. */
export async function closeAll(): Promise<void> {
  for (const [name, session] of sessions) {
    await session.context.close().catch(() => {});
    sessions.delete(name);
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

/** List active session names. */
export function listSessions(): string[] {
  return Array.from(sessions.keys()).filter((name) => {
    const s = sessions.get(name);
    return s && !s.page.isClosed();
  });
}

// --- Helpers ---

/**
 * Resolve a ref string to a Playwright locator.
 * Refs are formatted as "role:name" from the accessibility tree.
 * Examples: "link:Sign in", "button:Submit", "textbox:Search"
 */
function resolveRef(page: Page, ref: string): ReturnType<Page["locator"]> {
  const colonIdx = ref.indexOf(":");
  if (colonIdx > 0) {
    const role = ref.slice(0, colonIdx).trim();
    const name = ref.slice(colonIdx + 1).trim();
    return page.getByRole(role as any, { name, exact: false });
  }
  // Fallback: try as text
  return page.getByText(ref, { exact: false });
}
