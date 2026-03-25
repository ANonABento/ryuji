/**
 * Japanese dictionary — unofficial-jisho-api wrapper.
 *
 * Free, no API key needed. Returns readings, meanings, JLPT level,
 * parts of speech, kanji details, and example sentences.
 */

import JishoAPI from "unofficial-jisho-api";
import type { DictionaryEntry } from "../types.ts";

const jisho = new JishoAPI();

export async function lookupJisho(
  query: string
): Promise<DictionaryEntry[]> {
  const result = await jisho.searchForPhrase(query);

  return result.data.slice(0, 5).map((entry: any) => {
    const jp = entry.japanese[0];
    const sense = entry.senses[0];
    const jlptLevel =
      entry.jlpt.length > 0
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

/** Look up kanji details (strokes, meanings, readings) */
export async function lookupKanji(kanji: string) {
  try {
    return await jisho.searchForKanji(kanji);
  } catch {
    return null;
  }
}

/** Search for example sentences */
export async function searchExamples(query: string) {
  try {
    const result = await jisho.searchForExamples(query);
    return result.results.slice(0, 3).map((ex: any) => ({
      japanese: ex.kanji,
      reading: ex.kana,
      english: ex.english,
    }));
  } catch {
    return [];
  }
}
