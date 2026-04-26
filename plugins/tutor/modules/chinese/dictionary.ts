/**
 * Chinese dictionary integration for CC-CEDICT.
 *
 * CC-CEDICT lines use:
 * traditional simplified [pin1 yin1] /definition1/definition2/
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { DictionaryEntry } from "../../core/types.ts";
import { marksToNumbers, numbersToMarks, stripToneNumbers } from "./pinyin.ts";

export interface CedictEntry {
  traditional: string;
  simplified: string;
  pinyinNumbered: string;
  pinyinMarked: string;
  definitions: string[];
}

const BUNDLED_CEDICT_PATH = fileURLToPath(new URL("./data/cedict.txt", import.meta.url));

let entriesCache: CedictEntry[] | null = null;
let lookupCache: Map<string, CedictEntry[]> | null = null;

export function parseCedictLine(line: string): CedictEntry | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return null;

  const match = trimmed.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)]\s+\/(.+)\/$/);
  if (!match) return null;

  const [, traditional, simplified, pinyinNumbered, definitionText] = match;
  const definitions = definitionText
    .split("/")
    .map((definition) => definition.trim())
    .filter(Boolean);

  return {
    traditional,
    simplified,
    pinyinNumbered,
    pinyinMarked: numbersToMarks(pinyinNumbered),
    definitions,
  };
}

export function parseCedict(text: string): CedictEntry[] {
  return text
    .split(/\r?\n/)
    .map(parseCedictLine)
    .filter((entry): entry is CedictEntry => entry !== null);
}

function addLookup(map: Map<string, CedictEntry[]>, key: string, entry: CedictEntry) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return;
  const existing = map.get(normalized);
  if (existing) {
    existing.push(entry);
  } else {
    map.set(normalized, [entry]);
  }
}

function buildLookup(entries: CedictEntry[]): Map<string, CedictEntry[]> {
  const map = new Map<string, CedictEntry[]>();

  for (const entry of entries) {
    addLookup(map, entry.simplified, entry);
    addLookup(map, entry.traditional, entry);
    addLookup(map, entry.pinyinNumbered, entry);
    addLookup(map, entry.pinyinMarked, entry);
    addLookup(map, stripToneNumbers(entry.pinyinNumbered), entry);
  }

  return map;
}

function uniqueEntries(entries: CedictEntry[]): CedictEntry[] {
  const seen = new Set<string>();
  const unique: CedictEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.traditional}\t${entry.simplified}\t${entry.pinyinNumbered}\t${entry.definitions.join("/")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  return unique;
}

function toDictionaryEntry(entry: CedictEntry): DictionaryEntry {
  const variants =
    entry.traditional !== entry.simplified
      ? [`traditional: ${entry.traditional}`]
      : [];

  return {
    word: entry.simplified,
    reading: entry.pinyinMarked,
    meanings: entry.definitions,
    partOfSpeech: variants,
    examples: [],
  };
}

async function readCedictText(): Promise<string> {
  const path = process.env.CHOOMFIE_CEDICT_PATH || BUNDLED_CEDICT_PATH;
  return readFile(path, "utf8");
}

export async function initCedict(): Promise<void> {
  const text = await readCedictText();
  const entries = parseCedict(text);
  entriesCache = entries;
  lookupCache = buildLookup(entries);
}

async function ensureCedict(): Promise<{ entries: CedictEntry[]; lookup: Map<string, CedictEntry[]> }> {
  if (!entriesCache || !lookupCache) {
    await initCedict();
  }

  return { entries: entriesCache ?? [], lookup: lookupCache ?? new Map() };
}

export async function lookupCedict(query: string): Promise<DictionaryEntry[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const { entries, lookup } = await ensureCedict();
  const numberedQuery = marksToNumbers(normalized).toLowerCase();
  const barePinyinQuery = stripToneNumbers(numberedQuery);

  const exact = [
    ...(lookup.get(normalized) ?? []),
    ...(lookup.get(numberedQuery) ?? []),
    ...(lookup.get(barePinyinQuery) ?? []),
  ];

  if (exact.length > 0) {
    return uniqueEntries(exact).slice(0, 5).map(toDictionaryEntry);
  }

  const partial = entries.filter((entry) => {
    const definitions = entry.definitions.join("; ").toLowerCase();
    return (
      entry.simplified.includes(query) ||
      entry.traditional.includes(query) ||
      entry.pinyinNumbered.toLowerCase().includes(numberedQuery) ||
      entry.pinyinMarked.toLowerCase().includes(normalized) ||
      stripToneNumbers(entry.pinyinNumbered).toLowerCase().includes(barePinyinQuery) ||
      definitions.includes(normalized)
    );
  });

  return uniqueEntries(partial).slice(0, 5).map(toDictionaryEntry);
}
