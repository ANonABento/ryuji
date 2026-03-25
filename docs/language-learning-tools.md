# Language Learning — Tool Stack Research

Definitive tool choices for the language learning plugin, verified March 2026.

> Last updated: 2026-03-25

---

## Final Stack

### Use (Confirmed Good)

**`unofficial-jisho-api`** — Dictionary lookup
- npm package wrapping Jisho.org + kanji strokes + examples
- Maintained by mistval, no rate limits
- Replaces: raw Jisho API fetch

**`wanakana`** — Romaji/Kana conversion
- WaniKani team, 32k weekly npm downloads
- Converts romaji↔hiragana↔katakana
- Use for: accepting romaji input from beginners

**`ts-fsrs`** — Spaced repetition algorithm
- FSRS replaced SM-2 in Anki as of 2024, 15-20% fewer reviews for same retention
- v4.x, explicitly supports Bun (`bun add ts-fsrs`)
- Updated March 2026, TypeScript-first
- Replaces: planned SM-2 implementation

**Bluskyo/JLPT_Vocabulary** — Pre-built vocab decks
- Clean JSON format, N5-N1 complete
- Source: tanos.co.uk → Anki decks → reverse-engineered
- Static data, no maintenance needed
- GitHub: github.com/Bluskyo/JLPT_Vocabulary

### Use With Caution

**`kuroshiro`** + **`@sglkc/kuroshiro-analyzer-kuromoji`** — Furigana generation
- kuroshiro is stable but 5 years old (v1.2.0)
- DO NOT use original analyzer (8 years old) — use @sglkc fork (TypeScript, newer)
- Heavy bundle (~2MB for kuromoji dictionary)
- Fallback: budoux (Google, lighter) + wanakana if Bun compatibility breaks

**`hatsuon`** — Pitch accent SVG diagrams
- v2.0.0, 4 years old but functional
- Generates SVG pitch pattern visualizations
- Good enough for Phase 1, upgrade later if needed

### Skip / Replace

**Raw Jisho API** → use `unofficial-jisho-api` instead (better wrapper)

**SM-2 algorithm** → use `ts-fsrs` instead (FSRS is objectively better)

**bunpou/japanese-grammar-db** → sparse, unmaintained. Instead: curate 100-200 core grammar points manually + link to Tae Kim / Imabi / Bunpro externally

**Kanjium SQLite** → 15MB+ bundle, overkill for a bot. Use `hatsuon` for pitch + link to OJAD for advanced lookup

---

## What To Change in Current Plugin

1. **REPLACE** raw Jisho fetch in `dictionary.ts` → `unofficial-jisho-api`
2. **ADD** `wanakana` — romaji→kana for beginner input
3. **ADD** `ts-fsrs` — proper FSRS spaced repetition for SRS phase
4. **ADD** `kuroshiro` — auto-furigana on all bot JP text output
5. **ADD** Bluskyo JLPT vocab JSON — N5 starter deck data
6. **UPGRADE** quiz system → Discord buttons (ActionRow + ButtonBuilder)
7. **SKIP** grammar database → link externally

---

## Research Sources

### Niche Community Tools (Anime/Immersion)

- **Anki + subs2srs** — mine vocab from anime with screenshots + audio (1.56M+ cards)
- **jpdb.io** — pre-learn vocab before watching anime/VNs
- **Yomitan** — browser extension, hover-lookup + auto Anki card creation (2.4k stars)
- **Bunpro** — grammar SRS, fill-in-the-blank by JLPT level
- **WaniKani** — kanji SRS with mnemonics
- **Migaku** — sentence mining with pitch accent highlighting (12k Discord members)
- **TheMoeWay** — immersion-based learning guide (learnjapanese.moe)
- **Refold/AJATT** — immersion method, fastest to fluency (2-3 years)

### Teaching Methods Ranked

1. **Immersion (AJATT/Refold)** — fastest (2-3y), sentence mining from real content
2. **SRS (Anki/WaniKani)** — best for kanji retention, 1000+ kanji in 12-18mo
3. **AI Tutor** — best for output practice + real-time corrections
4. **Gamified (Duolingo)** — great for habits, plateaus at 6mo
5. **Textbook (Genki)** — solid foundation, boring alone

### Why People Quit (Address These)

1. Unrealistic expectations (40%) → set clear milestones
2. Kanji overwhelm (25%) → FSRS pacing, gamified progression
3. No accountability (20%) → streaks, server-wide challenges
4. Intermediate plateau (15%) → immersion tracking, visible progress

### Our Unique Advantages (AI Discord Bot)

- Zero friction (already where user hangs out)
- Real conversation practice (not multiple choice)
- Personality (persona-powered corrections)
- Voice integration (speak JP in VC)
- Community accountability (shared streaks)
- Adaptive difficulty (AI adjusts in real-time)

---

## GitHub Projects Reference

| Project | Stars | Purpose | Integrate? |
|---------|-------|---------|------------|
| unofficial-jisho-api | 166 | Dictionary npm package | YES — replacing raw API |
| kuroshiro | 961 | Furigana generation | YES — with newer analyzer fork |
| wanakana | — | Romaji↔kana | YES — for user input |
| ts-fsrs | — | FSRS algorithm | YES — replacing SM-2 |
| Kanjium | 325 | Pitch accent + kanji data | LATER — hatsuon for now |
| Kotoba bot | 188 | Existing JP Discord bot | REFERENCE — study architecture |
| Manga OCR | 2.6k | Read kanji from images | LATER — Phase 4 |
| Yomitan | 2.4k | Browser dictionary ext | REFERENCE — dictionary format |
| JmdictFurigana | 201 | Furigana mappings JSON | MAYBE — fallback data |
| bunpou grammar-db | 3 | Grammar points JSON | SKIP — too sparse |
