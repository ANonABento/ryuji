/**
 * Jisho API — Japanese dictionary lookup.
 *
 * Free, no API key needed. Returns readings, meanings, JLPT level, parts of speech.
 */

import type { DictionaryEntry } from "../types.ts";

const JISHO_API = "https://jisho.org/api/v1/search/words";

export async function lookupJisho(query: string): Promise<DictionaryEntry[]> {
  const response = await fetch(
    `${JISHO_API}?keyword=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error(`Jisho API error (${response.status})`);
  }

  const data = (await response.json()) as {
    data: Array<{
      slug: string;
      jlpt: string[];
      japanese: Array<{ word?: string; reading: string }>;
      senses: Array<{
        english_definitions: string[];
        parts_of_speech: string[];
      }>;
    }>;
  };

  return data.data.slice(0, 5).map((entry) => {
    const jp = entry.japanese[0];
    const sense = entry.senses[0];
    const jlptLevel = entry.jlpt.length > 0
      ? entry.jlpt[0].replace("jlpt-", "JLPT ").toUpperCase()
      : undefined;

    return {
      word: jp.word || jp.reading,
      reading: jp.reading,
      meanings: sense?.english_definitions || [],
      partOfSpeech: sense?.parts_of_speech || [],
      level: jlptLevel,
    };
  });
}
