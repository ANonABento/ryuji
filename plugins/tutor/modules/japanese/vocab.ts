/**
 * Typed access to the built-in JLPT N5 vocabulary deck.
 */

import n5VocabJson from "./data/n5-vocab.json";

export interface JapaneseVocabItem {
  front: string;
  reading: string;
  back: string;
  tags: string;
}

function isCompleteVocabItem(item: JapaneseVocabItem): boolean {
  return Boolean(item.front.trim() && item.reading.trim() && item.back.trim());
}

export const n5Vocab: JapaneseVocabItem[] = (n5VocabJson as JapaneseVocabItem[]).filter(
  isCompleteVocabItem
);
