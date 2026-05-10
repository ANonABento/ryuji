# Tutor Plugin v3 — Enhanced Learning System

> Status: Spec draft
> Date: 2026-04-12
> Based on: Genki Study Resources patterns, DeepTutor agent patterns

## Overview

Two phases of improvements to the tutor plugin, inspired by research into Genki Study Resources (structured exercise patterns) and DeepTutor (adaptive learning, auto-profiling).

**Phase A** — Quick wins. Low effort, ship individually.
**Phase B** — Core upgrades. Medium effort, bigger impact.

---

## Phase A: Quick Wins

### A1. Chart Completion Exercises

**What:** New exercise type — show a partial kana grid with blanks, user fills them in via buttons.

**Why:** Kana grids reinforce systematic memorization better than isolated flashcards. Users see relationships between character rows (ka-ki-ku-ke-ko) instead of random individual chars.

**How:**
- New exercise type `"chart"` in `lesson-types.ts`
- Embed renders a 5x10-ish grid (monospace block) with some cells replaced by `__`
- Buttons below show candidate characters — user picks the right one for each blank
- Sequential fill: highlight one blank at a time, cycle through
- Add chart exercises to unit-1-hiragana.ts as review exercises at end of every 3 lessons (1.3, 1.6, 1.8)

**Exercise type definition:**
```typescript
interface ChartExercise extends Exercise {
  type: "chart";
  grid: (string | null)[][]; // null = blank to fill
  blanks: { row: number; col: number; answer: string }[];
}
```

**Discord UX:**
```
┌───┬───┬───┬───┬───┐
│ あ│ い│ う│ ??│ お│  ← user fills ??
├───┼───┼───┼───┼───┤
│ か│ き│ ??│ け│ こ│
└───┴───┴───┴───┴───┘

[え] [く] [す] [ぬ]   ← button choices
```

**Files to modify:**
- `plugins/tutor/core/lesson-types.ts` — add `"chart"` exercise type + ChartExercise
- `plugins/tutor/lesson-interactions.ts` — render chart embed + button handler
- `plugins/tutor/modules/japanese/lessons/unit-1-hiragana.ts` — add chart review exercises

---

### A2. Random Word Widget

**What:** New MCP tool `random_word` + optional daily auto-post. Shows a random N5 vocab word with spoiler-hidden meaning.

**Why:** Low-effort passive engagement. Users learn by exposure even when not actively studying.

**How:**
- New tool: `random_word` — picks random entry from n5-vocab.json
- Returns: word, reading (spoiler), meaning (spoiler)
- Optional: scheduled auto-post to a configured channel (wire to reminder/cron system)

**Discord output:**
```
📚 Word of the Day

食べる (たべる)
Meaning: ||to eat||

React ✅ if you knew it!
```

**Files to create/modify:**
- `plugins/tutor/tools/random-word.ts` — new tool
- `plugins/tutor/modules/japanese/index.ts` — add `getRandomWord()` method to module interface

---

### A3. SRS-Driven Study Reminders

**What:** When a user has due SRS cards, auto-remind them via the existing reminder system.

**Why:** SRS only works if users actually review when cards are due. Currently they have to manually check. DeepTutor's "proactive heartbeat" pattern but using our existing infrastructure.

**How:**
- On worker startup + periodic check (every 4 hours): query SRS for each user with active cards
- If user has >5 due cards and hasn't been reminded in the last 24h, create a one-off reminder
- Reminder message: "You have X cards due for review! Use `/srs_review` to start."
- Track last reminder time per user to avoid spam
- Configurable: opt-out via a user setting (stored in lesson DB)

**Implementation:**
- Add `checkDueReminders()` function to `plugins/tutor/core/srs.ts`
- Call from tutor plugin `init()` on a `setInterval` (4h)
- Use existing `ReminderScheduler` from core (available via ctx)

**Files to modify:**
- `plugins/tutor/index.ts` — add periodic check in init()
- `plugins/tutor/core/srs.ts` — add `getDueCountByUser()` query

---

### A4. Incremental Furigana Removal

**What:** Difficulty scaling within exercises — early exercises show full furigana, later ones progressively hide it.

**Why:** Genki pattern. Gradual removal forces users to learn kanji readings organically instead of always relying on furigana crutch.

**How:**
- Add `furiganaLevel` to exercise or lesson metadata: `"full" | "partial" | "none"`
  - `full`: 食[た]べる (show all readings)
  - `partial`: 食べる (kanji only, no reading aid)
  - `none`: 食べる (no hints at all)
- Lesson definitions set furigana level per unit:
  - Unit 1-2 (kana): N/A
  - Unit 3 (first words): `full`
  - Unit 4 (grammar): `partial`
  - Unit 5+: `none`
- The `tutor_prompt` tool already guides Claude's behavior — update the prompt template to include furigana level for conversational practice

**Files to modify:**
- `plugins/tutor/core/lesson-types.ts` — add `furiganaLevel` to Lesson
- `plugins/tutor/modules/japanese/index.ts` — use furigana level in tutor prompt
- Future lesson files reference this when writing exercise prompts

---

### A5. Vocab-First Lesson Flow

**What:** Enforce vocab mastery before grammar practice within a unit. Vocab sub-lessons are prerequisites for grammar sub-lessons.

**Why:** Genki's study guide is explicit — vocab first, grammar second. You can't practice "XはYです" if you don't know what X and Y mean.

**How:**
- This is already supported by the prerequisite system! Just structure future lesson data correctly:
  - `3.1` Vocab: Greetings → `3.2` Vocab: People → `3.3` Grammar: XはYです (prereqs: 3.1, 3.2)
- No code changes needed — just a lesson authoring convention
- Document in a `LESSON_AUTHORING.md` guide for future lesson creation

**Files to create:**
- `plugins/tutor/LESSON_AUTHORING.md` — conventions for writing lessons

---

## Phase B: Core Upgrades

### B1. Multi-Mode Exercises

**What:** Same content set can be practiced in multiple modes — MC, spelling (typed), matching. User picks mode or system auto-selects.

**Why:** This is Genki's killer pattern. One vocab set generates 3-4x the exercise variety. Users who are bored of MC can switch to spelling. Users who struggle with production can fall back to recognition.

**How:**

#### Exercise Modes
```typescript
type ExerciseMode = "recognition" | "production" | "matching";
```

Given a set of `(term, reading, meaning)` tuples:
- **Recognition** (existing): show term → pick meaning from buttons
- **Production** (existing): show meaning → type term
- **Matching** (new): show 4-5 pairs, user matches them sequentially via buttons

#### Mode Selection
Two approaches (implement both):
1. **Lesson-defined**: lesson data specifies which modes to use per exercise block
2. **User choice**: before starting exercises, show mode picker buttons:
   ```
   How do you want to practice?
   [Multiple Choice] [Spelling] [Matching]
   ```

#### Matching Mode UX
```
Match the pairs! (1/4)

あ → ?

[a] [i] [u] [e]
```
After correct match, show next pair. Track score same as other exercises.

#### Content Generators
Instead of hand-writing every exercise, define content sets that auto-generate exercises:

```typescript
interface ContentSet {
  items: Array<{ term: string; reading: string; meaning: string }>;
  modes: ExerciseMode[];
}

function generateExercises(content: ContentSet, mode: ExerciseMode): Exercise[] {
  // Auto-generate exercises from content + mode
}
```

This means lesson authors define **content** and the engine generates **exercises**. Dramatically reduces lesson authoring effort.

**Files to create/modify:**
- `plugins/tutor/core/lesson-types.ts` — add `ExerciseMode`, `ContentSet`
- `plugins/tutor/core/exercise-generator.ts` — new file, generates exercises from content sets
- `plugins/tutor/lesson-interactions.ts` — add mode picker, matching mode handler
- `plugins/tutor/modules/japanese/lessons/*.ts` — refactor to use content sets

---

### B2. Auto-Updating Learner Profile

**What:** After each learning interaction, the LLM updates a per-user learner profile that tracks knowledge level, learning style, strengths/weaknesses.

**Why:** DeepTutor's best pattern. Two markdown files (PROFILE.md + SUMMARY.md) auto-rewritten after every session. Makes the AI tutor actually adaptive — it remembers what you struggle with and adjusts.

**How:**

#### Profile Structure
Store in memory system (existing `save_memory` / `search_memory`):
```
Key: learner-profile:{userId}
Value: (markdown)
---
## Identity
- Discord user, studying Japanese
- Level: N5 (beginner)
- Started: 2026-04-01

## Knowledge State
- Hiragana: mastered (lessons 1.1-1.8 complete, 95% avg)
- Katakana: in progress (lesson 2.3)
- Grammar: not started
- Weak areas: dakuten (が vs か confusion), particle は vs が

## Learning Style
- Prefers multiple choice over typing
- Studies in short bursts (5-10 min sessions)
- Responds well to mnemonics
- Gets frustrated with cloze exercises

## Session History
- Last session: 2026-04-11, 15 min, reviewed 12 SRS cards (8 correct)
- Streak: 3 days
---
```

#### Auto-Update Flow
1. After lesson completion or SRS review session, gather stats
2. Pass current profile + session stats to Claude via `tutor_prompt` enhancement
3. Claude rewrites the profile as part of its response (or we do it deterministically from stats)
4. Save updated profile to memory

#### Two Approaches (pick one):
- **Deterministic** (recommended for v1): update profile from hard data only — lesson scores, SRS stats, exercise type preferences. No LLM call needed. Fast, predictable, free.
- **LLM-enhanced** (v2): after each conversation with the tutor, ask Claude to update the profile with observations about learning style. More nuanced but costs tokens.

#### Integration with Tutor Prompt
The `tutor_prompt` tool already returns a system prompt for Claude. Append the learner profile so Claude can adapt:
```
You are tutoring {user}. Here is their learner profile:
{profile}

Adjust your teaching based on their level, weak areas, and learning style.
```

**Files to create/modify:**
- `plugins/tutor/core/learner-profile.ts` — new file, profile CRUD + auto-update logic
- `plugins/tutor/tools/tutor-tools.ts` — inject profile into tutor_prompt
- `plugins/tutor/lesson-interactions.ts` — call profile update after lesson completion
- `plugins/tutor/tools/srs-tools.ts` — call profile update after review session

---

### B3. More Lesson Content

**What:** Add katakana unit, basic phrases unit, and intro grammar unit.

**Why:** 10 hiragana lessons is a dealbreaker. Users complete them in a day and have nothing left. Need at minimum 3 more units to cover the Genki Lesson 0 equivalent.

**How:**

#### Unit 2: Katakana (10 lessons, mirrors hiragana structure)
- 2.1 Vowels: アイウエオ
- 2.2 K-row: カキクケコ
- 2.3 S-row: サシスセソ
- 2.4 T-row: タチツテト
- 2.5 N-row: ナニヌネノ
- 2.6 H-row: ハヒフヘホ
- 2.7 M-row: マミムメモ
- 2.8 Y+R+W+N: ヤユヨラリルレロワヲン
- 2.9 Dakuten: ガギグゲゴ ザジズゼゾ ダヂヅデド バビブベボ
- 2.10 Handakuten + combos: パピプペポ + キャ キュ キョ etc.

Prerequisites: Unit 1 complete (all hiragana)

#### Unit 3: First Words & Phrases (8 lessons)
- 3.1 Greetings: おはよう、こんにちは、こんばんは、さようなら
- 3.2 Self-intro: はじめまして、私は___です、よろしくお願いします
- 3.3 Numbers 1-10: いち、に、さん...
- 3.4 Numbers 11-100 + counters
- 3.5 Days of the week: 月曜日〜日曜日
- 3.6 Common objects: 本、ペン、水、電話...
- 3.7 Common verbs: 食べる、飲む、行く、来る、見る
- 3.8 Common adjectives: 大きい、小さい、いい、悪い

Prerequisites: Unit 2 complete (need katakana for loanwords)

#### Unit 4: Basic Grammar (6 lessons)
- 4.1 XはYです (X is Y)
- 4.2 Question sentences: か particle, question words
- 4.3 Particles: は、が、を、に、で、へ
- 4.4 Verb conjugation: ます form
- 4.5 Adjective conjugation: い/な adjectives
- 4.6 Time expressions: 今、昨日、明日、〜時

Prerequisites: 3.1-3.2 for grammar context

#### Exercise content
With B1 (multi-mode exercises) implemented, lesson authoring becomes defining content sets rather than hand-writing every exercise. Each lesson needs:
- 5-10 content items (term/reading/meaning)
- Introduction text with explanations
- SRS items for auto-import
- The engine generates recognition/production/matching exercises automatically

**Files to create:**
- `plugins/tutor/modules/japanese/lessons/unit-2-katakana.ts`
- `plugins/tutor/modules/japanese/lessons/unit-3-phrases.ts`
- `plugins/tutor/modules/japanese/lessons/unit-4-grammar.ts`
- Update `plugins/tutor/modules/japanese/lessons/index.ts` to register new units

**Effort note:** This is the highest-effort item but also the most critical. With B1 (content sets → auto-generated exercises), the per-lesson effort drops significantly. Recommend implementing B1 first, then authoring units 2-4 using the new content set pattern.

---

## Implementation Order

```
A5 (vocab-first docs)           ← 30 min, just documentation
A4 (furigana levels)             ← 1 hour, type + metadata only
A2 (random word)                 ← 1 hour, new tool
A3 (SRS reminders)               ← 2 hours, wire SRS to reminders
A1 (chart exercises)             ← 3 hours, new exercise type + UX
B1 (multi-mode exercises)        ← 6 hours, exercise generator + matching mode
B2 (learner profile)             ← 4 hours, deterministic v1
B3 (more content)                ← 8 hours, 3 new units (faster with B1)
```

**Total estimated scope:** ~25 hours of implementation

## Dependencies

```
A5 → (none)
A4 → (none, but useful for B3)
A2 → (none)
A3 → core reminder system
A1 → lesson-interactions.ts button system
B1 → lesson-types.ts, lesson-interactions.ts (biggest refactor)
B2 → memory system, tutor-tools.ts
B3 → B1 (strongly recommended), A4
```

## Open Questions

1. **Chart exercise scope**: Just hiragana/katakana or extend to kanji radical charts later?
2. **Random word scheduling**: MCP tool only, or auto-post to a configured channel?
3. **Learner profile storage**: Use existing memory system (save_memory) or dedicated table in lessons.db?
4. **Grammar lesson format**: How interactive can grammar explanations be in Discord? Embeds with examples + MC exercises, or more conversational (route to Claude)?
5. **Matching mode cap**: Max 5 pairs per match exercise? Discord button limit is 25 (5 rows of 5).
6. **Content set format**: JSON data files or TypeScript objects? JSON is easier for non-dev contributors.
