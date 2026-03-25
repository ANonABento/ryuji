/**
 * Kana utilities — romaji↔kana conversion via wanakana.
 *
 * Detects input type and converts between romaji, hiragana, katakana.
 * Useful for beginners who type in romaji.
 */

import * as wanakana from "wanakana";

/** Convert romaji to hiragana: "taberu" → "たべる" */
export function toHiragana(input: string): string {
  return wanakana.toHiragana(input);
}

/** Convert romaji to katakana: "taberu" → "タベル" */
export function toKatakana(input: string): string {
  return wanakana.toKatakana(input);
}

/** Convert kana to romaji: "たべる" → "taberu" */
export function toRomaji(input: string): string {
  return wanakana.toRomaji(input);
}

/** Check if input is romaji */
export function isRomaji(input: string): boolean {
  return wanakana.isRomaji(input);
}

/** Check if input is hiragana */
export function isHiragana(input: string): boolean {
  return wanakana.isHiragana(input);
}

/** Check if input is katakana */
export function isKatakana(input: string): boolean {
  return wanakana.isKatakana(input);
}

/** Check if input is kana (hiragana or katakana) */
export function isKana(input: string): boolean {
  return wanakana.isKana(input);
}

/** Check if input contains Japanese (kana or kanji) */
export function isJapanese(input: string): boolean {
  return wanakana.isJapanese(input);
}

/** Strip okurigana from a word: "食べる" → "食" */
export function stripOkurigana(input: string): string {
  return wanakana.stripOkurigana(input);
}
