/**
 * Anki flashcard export — pure, Discord-free.
 *
 * Emits a 4-column TSV (Front, Reading, Back, Tags) with Anki header directives.
 * See .task.md for format rationale.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SRSCard } from "./srs.ts";

const COLUMNS = ["Front", "Reading", "Back", "Tags"] as const;

/** Escape a single field value: strip \r, replace \t/\n with safe equivalents. */
function escapeField(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\n/g, "<br>");
}

/** Convert our comma-separated tag storage to Anki's space-separated format. */
function formatTags(raw: string): string {
  if (!raw) return "";
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/\s+/g, "_"))
    .join(" ");
}

/**
 * Build Anki-compatible TSV body. Always emits 4 columns even for non-Japanese
 * decks (Reading may be empty).
 */
export function formatAnkiTSV(cards: SRSCard[], deck?: string): string {
  const headerLines = [
    "#separator:tab",
    "#html:true",
    "#notetype:Basic (and reversed card)",
  ];
  if (deck) headerLines.push(`#deck:${deck}`);
  headerLines.push(`#columns:${COLUMNS.join(" ")}`);
  headerLines.push("#tags column:4");

  const rows = cards.map((c) =>
    [
      escapeField(c.front),
      escapeField(c.reading ?? ""),
      escapeField(c.back),
      formatTags(c.tags ?? ""),
    ].join("\t")
  );

  return [...headerLines, ...rows].join("\n") + "\n";
}

/** Slugify a fragment for safe use in a filename. */
function slugify(input: string, maxLen = 40): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.slice(0, maxLen) || "export";
}

/** `YYYYMMDD-HHMMSS` in UTC — safe across filesystems. */
function timestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

export function buildExportFilename(
  deck: string | undefined,
  tag: string | undefined,
  now: Date = new Date()
): string {
  const parts: string[] = ["anki-export"];
  if (deck) parts.push(slugify(deck));
  if (tag) parts.push(slugify(tag));
  if (parts.length === 1) parts.push("all");
  parts.push(timestamp(now));
  return `${parts.join("-")}.txt`;
}

export async function writeAnkiExport(
  dir: string,
  filename: string,
  body: string
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, filename);
  await writeFile(path, body, "utf8");
  return path;
}
