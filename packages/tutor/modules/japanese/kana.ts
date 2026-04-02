/**
 * Kana utilities — romaji ↔ kana conversion via wanakana.
 */

import * as wanakana from "wanakana";

export function toHiragana(input: string): string {
  return wanakana.toHiragana(input);
}

export function toKatakana(input: string): string {
  return wanakana.toKatakana(input);
}

export function toRomaji(input: string): string {
  return wanakana.toRomaji(input);
}

export function isRomaji(input: string): boolean {
  return wanakana.isRomaji(input);
}

export function isHiragana(input: string): boolean {
  return wanakana.isHiragana(input);
}

export function isKatakana(input: string): boolean {
  return wanakana.isKatakana(input);
}

export function isKana(input: string): boolean {
  return wanakana.isKana(input);
}

export function isJapanese(input: string): boolean {
  return wanakana.isJapanese(input);
}

export function stripOkurigana(input: string): string {
  return wanakana.stripOkurigana(input);
}
