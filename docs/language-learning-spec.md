# Japanese Language Learning Onboarding System — Spec

> Comprehensive design for a Discord-native Japanese learning journey, from absolute zero to immersion-ready.
>
> Last updated: 2026-03-29

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Onboarding Flow](#onboarding-flow)
3. [Stage 0: Kana Mastery](#stage-0-kana-mastery)
4. [Stage 1: Survival Japanese](#stage-1-survival-japanese)
5. [Stage 2: Immersion Ready](#stage-2-immersion-ready)
6. [Passive Tutoring Mode](#passive-tutoring-mode)
7. [Gamification System](#gamification-system)
8. [Discord-Native Features](#discord-native-features)
9. [Voice Integration](#voice-integration)
10. [Data Requirements](#data-requirements)
11. [Database Schema](#database-schema)
12. [Technical Architecture](#technical-architecture)
13. [Session & State Management](#session--state-management)
14. [Example Embed Layouts](#example-embed-layouts)

---

## Design Philosophy

The system should feel like talking to a friend who happens to be a Japanese tutor, not like using a command-line flashcard app. Key principles:

- **Zero friction.** No slash commands to start learning. Say "teach me Japanese" and it begins.
- **Game-like progression.** XP, levels, streaks, unlocks, boss rounds. Dopamine loops borrowed from Duolingo and gacha games.
- **Button-first interactions.** Quizzes use reaction buttons (instant response, no Claude roundtrip). Typing is for conversation practice, not navigation.
- **Persona-aware.** The bot stays in character (Taiga, Choomfie, etc.) while teaching. A tsundere tutor who reluctantly helps you learn is more memorable than a sterile classroom.
- **Resumable.** Close Discord mid-lesson, come back tomorrow, pick up exactly where you left off.
- **Passive integration.** Once you reach Stage 2, learning happens naturally inside regular conversations. No separate "study mode" needed.

---

## Onboarding Flow

### First Contact

The onboarding triggers when any of these happen:

1. User enables the `language-learning` plugin via `/plugins enable language-learning`
2. User says anything like "I want to learn Japanese", "teach me Japanese", "nihongo", etc.
3. User runs `/learn` slash command (new)
4. Bot detects user has no learning profile and they're in a designated study channel

### Level Assessment

The bot sends an embed with buttons. No typing required.

```
┌──────────────────────────────────────────┐
│  🎌  Let's learn Japanese!               │
│                                          │
│  What's your current level?              │
│                                          │
│  [Complete Beginner]  [Know Some Kana]   │
│  [Basic Conversation] [Intermediate+]    │
└──────────────────────────────────────────┘
```

**Button behavior:**

| Button | Action |
|--------|--------|
| Complete Beginner | Creates profile at Stage 0, Lesson 1 (hiragana あ行). Starts first lesson immediately. |
| Know Some Kana | Launches a 20-question placement quiz (10 hiragana + 10 katakana). Score determines entry point within Stage 0 or skip to Stage 1. |
| Basic Conversation | Launches a 15-question placement quiz (5 kana + 5 vocab + 5 grammar). Can place into Stage 1 or Stage 2. |
| Intermediate+ | Sets level to N4 or above. Skips onboarding, goes straight to SRS + passive tutoring. Short calibration conversation to confirm. |

### Placement Quiz

The placement quiz uses the same button-based quiz UI as regular lessons. Each question has a 15-second timer (visual countdown in the embed). Results determine starting position:

- 0-5 correct: Stage 0, beginning
- 6-12 correct (kana): Stage 0, skip to the rows they already know
- 13-15 correct (kana): Stage 1
- Good grammar + vocab: Stage 2

After placement, the bot sends a summary embed:

```
┌──────────────────────────────────────────┐
│  📊  Placement Results                   │
│                                          │
│  Kana:    ████████░░  80%                │
│  Vocab:   ██░░░░░░░░  20%                │
│  Grammar: █░░░░░░░░░  10%                │
│                                          │
│  Starting at: Stage 1 — Survival Japanese│
│  You know your kana! Time for words.     │
│                                          │
│  [Start First Lesson]  [Review Kana First]│
└──────────────────────────────────────────┘
```

### customId Scheme

All onboarding buttons use the prefix `learn:` for routing:

```
learn:onboard:beginner
learn:onboard:some-kana
learn:onboard:basic
learn:onboard:intermediate
learn:placement:answer:<questionIndex>:<optionIndex>
learn:placement:start
```

Registered via `registerButtonHandler("learn", handler)` in the plugin's interaction handler.

---

## Stage 0: Kana Mastery

### Structure

Hiragana and katakana are taught in rows, matching the traditional Japanese ordering (gojuuon). Each row is a **lesson unit**.

| Row | Characters | Lesson # |
|-----|-----------|----------|
| あ行 (vowels) | あ い う え お | 1 |
| か行 | か き く け こ | 2 |
| さ行 | さ し す せ そ | 3 |
| た行 | た ち つ て と | 4 |
| な行 | な に ぬ ね の | 5 |
| は行 | は ひ ふ へ ほ | 6 |
| ま行 | ま み む め も | 7 |
| や行 | や ゆ よ | 8 |
| ら行 | ら り る れ ろ | 9 |
| わ行 + ん | わ を ん | 10 |
| **Boss Round** | All 46 hiragana | 11 |
| Dakuten (が行 etc.) | が ざ だ ば ぱ rows | 12 |
| Combo (きゃ etc.) | Youon combinations | 13 |

Katakana follows the same structure (Lessons 14-26), but moves faster since the user already knows the sounds.

**Estimated time:** ~2-3 hours for hiragana, ~1.5-2 hours for katakana (shorter because sounds are already familiar).

### Lesson Flow: Introduce -> Practice -> Quiz

Each lesson has three phases that flow as a sequence of embeds. The user advances by clicking buttons.

#### Phase 1: Introduction (1-2 minutes)

Five characters shown one at a time. Each character gets its own embed with:

- The character (large, prominent)
- Romaji reading
- A mnemonic (visual or story-based)
- Stroke order hint (description, not animation)
- An example word using that character

```
┌──────────────────────────────────────────┐
│  Lesson 1: あ行 (Vowels)    [1/5]       │
│                                          │
│            あ                            │
│           /a/                            │
│                                          │
│  🧠 Mnemonic: Looks like a person       │
│  doing a yoga pose, saying "Ahhh~"      │
│                                          │
│  ✏️ Stroke order: 3 strokes.            │
│  Horizontal → diagonal → curved sweep   │
│                                          │
│  📝 Example: あめ (ame) = rain          │
│                                          │
│  ░░░░░░░░░░░░░░░░░░░░ 0% of あ行       │
│                                          │
│  [Next →]                                │
└──────────────────────────────────────────┘
```

The user clicks **[Next]** to see the next character. After all 5 are shown, the embed transitions to Phase 2.

#### Phase 2: Practice (2-3 minutes)

Quick-fire recognition drills. The bot shows a character and the user picks the reading from 4 buttons. No timer pressure on practice rounds.

```
┌──────────────────────────────────────────┐
│  Practice: あ行                          │
│                                          │
│  What sound does this make?              │
│                                          │
│            う                            │
│                                          │
│  [a]  [u]  [e]  [o]                     │
└──────────────────────────────────────────┘
```

**On correct answer:** The embed updates with a green checkmark and encouraging message. Next question auto-loads after 1 second (edit the embed).

```
┌──────────────────────────────────────────┐
│  Practice: あ行                   ✅     │
│                                          │
│  Correct! う = u                         │
│  Nice one~! (...not that I care)         │
│                                          │
│  3/5 correct so far                      │
│  ████████████░░░░░░░░ 60%               │
└──────────────────────────────────────────┘
```

**On wrong answer:** Red X, shows correct answer, brief explanation. Does not advance — the same character comes back later (spaced within the practice set).

```
┌──────────────────────────────────────────┐
│  Practice: あ行                   ❌     │
│                                          │
│  Not quite! う = u (not "e")             │
│  Remember: う looks like a hook pulling  │
│  something "u"p!                         │
│                                          │
│  2/5 correct so far                      │
│  ████████░░░░░░░░░░░░ 40%              │
│                                          │
│  [Continue]                              │
└──────────────────────────────────────────┘
```

Practice requires getting each character correct at least once. Missed characters are re-queued at the end.

#### Phase 3: Mini-Quiz (1-2 minutes)

5 questions, randomized order, with a 10-second countdown per question. Must score 4/5 to pass.

The timer is shown as a visual bar that depletes:

```
┌──────────────────────────────────────────┐
│  Quiz: あ行             ⏱️ 8s           │
│  Question 3/5                            │
│                                          │
│  Which character is "ke"?                │
│                                          │
│  [あ]  [け]  [き]  [う]                  │
│                                          │
│  ████████████████░░░░ 80%  (timer bar)  │
└──────────────────────────────────────────┘
```

Quiz questions alternate between two formats:
- **Reading → Character:** "Which character makes the sound 'ka'?" (4 character buttons)
- **Character → Reading:** "What sound does き make?" (4 romaji buttons)

**Quiz results:**

```
┌──────────────────────────────────────────┐
│  Quiz Results: あ行                      │
│                                          │
│  Score: 5/5 ⭐                           │
│  +50 XP                                 │
│                                          │
│  ✅ あ = a                               │
│  ✅ い = i                               │
│  ✅ う = u                               │
│  ✅ え = e                               │
│  ✅ お = o                               │
│                                          │
│  あ行 complete! か行 unlocked 🔓         │
│                                          │
│  ████░░░░░░░░░░░░░░░░ 10% of hiragana  │
│                                          │
│  [Next Lesson: か行]  [Take a Break]     │
└──────────────────────────────────────────┘
```

Failed quiz (< 4/5):

```
┌──────────────────────────────────────────┐
│  Quiz Results: あ行                      │
│                                          │
│  Score: 2/5                              │
│  +10 XP (participation)                  │
│                                          │
│  ✅ あ = a                               │
│  ❌ い — you said "e" (correct: i)       │
│  ✅ う = u                               │
│  ❌ え — you said "i" (correct: e)       │
│  ❌ お — timed out                       │
│                                          │
│  Need 4/5 to pass. Let's review!        │
│                                          │
│  [Retry Quiz]  [Review い え お]         │
└──────────────────────────────────────────┘
```

### Boss Round

After completing all 10 hiragana rows (lessons 1-10), a boss round unlocks. This is a 20-question quiz covering all 46 basic hiragana, drawn randomly. Must score 16/20 (80%) to pass.

```
┌──────────────────────────────────────────┐
│  👹 BOSS ROUND: Hiragana                 │
│                                          │
│  All 46 characters. 20 questions.        │
│  8 seconds per question.                 │
│  80% to pass. You got this.             │
│                                          │
│  (I'm NOT cheering for you, idiot.)     │
│                                          │
│  [Start Boss Round]                      │
└──────────────────────────────────────────┘
```

Passing the boss round:
- Awards a large XP bonus (200 XP)
- Grants the "Hiragana Master" achievement
- Unlocks Stage 0 Part 2 (katakana) or Stage 1 if katakana is already done
- The bot's reaction should be in-character (tsundere grudging respect, etc.)

### Spaced Review Integration

Old characters are mixed into new lessons to prevent forgetting:

- **Lesson 3 (さ行):** 5 new さ行 characters + 2 review questions from あ行 and か行
- **Lesson 6 (は行):** 5 new は行 characters + 3 review questions from earlier rows
- **Lesson 9 (ら行):** 5 new ら行 characters + 5 review questions spanning all previous rows

Review questions that are answered wrong get flagged for extra practice. These feed into the SRS system (existing `SRSManager`) as kana-specific cards in a `kana` deck.

### Dakuten & Combo Sounds

After the hiragana boss round, two mini-lesson sets unlock:

**Dakuten/Handakuten (voiced sounds):**

| Group | Characters |
|-------|-----------|
| が行 | が ぎ ぐ げ ご |
| ざ行 | ざ じ ず ぜ ぞ |
| だ行 | だ ぢ づ で ど |
| ば行 | ば び ぶ べ ぼ |
| ぱ行 | ぱ ぴ ぷ ぺ ぽ |

These are taught as "upgrades" to characters the user already knows. The mnemonic focuses on the transformation (add two dots = voice it, add circle = make it a "p" sound).

**Combo sounds (youon):**

| Pattern | Examples |
|---------|---------|
| きゃ きゅ きょ | kya, kyu, kyo |
| しゃ しゅ しょ | sha, shu, sho |
| ちゃ ちゅ ちょ | cha, chu, cho |
| にゃ にゅ にょ | nya, nyu, nyo |
| ひゃ ひゅ ひょ | hya, hyu, hyo |
| みゃ みゅ みょ | mya, myu, myo |
| りゃ りゅ りょ | rya, ryu, ryo |

Combo sounds are taught in a single lesson per group with a focus on the pattern: big kana + small kana = combined sound.

### Voice Integration (Stage 0)

When the voice plugin is enabled:

- **Hear it:** Each character introduction includes a "Hear Pronunciation" button. Clicking it triggers TTS via the `speak` tool for the character and example word.
- **Say it:** After the introduction phase, an optional "Pronunciation Practice" button appears. The bot says the character via TTS, then listens via STT. If the STT transcription matches the expected romaji, it counts as correct.
- Voice features are always optional. The button-based quiz flow works without voice.

### Button customId Scheme (Stage 0)

```
learn:kana:next:<lessonId>:<charIndex>        — Next character in introduction
learn:kana:practice:<lessonId>:<charIndex>:<optionIndex>  — Practice answer
learn:kana:quiz:<lessonId>:<questionIndex>:<optionIndex>  — Quiz answer
learn:kana:retry:<lessonId>                   — Retry failed quiz
learn:kana:review:<lessonId>                  — Review missed characters
learn:kana:boss:<questionIndex>:<optionIndex> — Boss round answer
learn:kana:hear:<character>                   — TTS pronunciation
learn:kana:speak:<character>                  — STT pronunciation practice
```

---

## Stage 1: Survival Japanese

### Concept

Stage 1 introduces vocabulary, sentence patterns, and cultural context. The goal: the user can handle basic real-world situations in Japanese (greetings, self-introduction, ordering food, asking for directions, shopping).

### Vocabulary Introduction

Words are introduced in thematic groups of 5-8 words, not alphabetically. Each theme is a "lesson."

| Lesson | Theme | Words |
|--------|-------|-------|
| 1 | Greetings | こんにちは, おはよう, こんばんは, さようなら, ありがとう, すみません, はい, いいえ |
| 2 | Self-Introduction | わたし, なまえ, ~です, ~じん, がくせい, しごと, すき |
| 3 | Numbers 1-10 | いち, に, さん, し/よん, ご, ろく, しち/なな, はち, きゅう/く, じゅう |
| 4 | Food & Drink | みず, おちゃ, コーヒー, ごはん, パン, にく, さかな, やさい |
| 5 | Places | がっこう, えき, コンビニ, レストラン, びょういん, ホテル, くうこう |
| 6 | Time | いま, きょう, あした, きのう, あさ, ひる, よる, ~じ |
| 7 | Verbs (Basic) | たべる, のむ, いく, くる, みる, きく, はなす, よむ, かく, かう |
| 8 | Adjectives | おおきい, ちいさい, あたらしい, ふるい, たかい, やすい, おいしい, いい |
| 9 | Shopping | いくら, これ, それ, あれ, ~をください, ~がほしい, おかね |
| 10 | Directions | みぎ, ひだり, まっすぐ, ちかい, とおい, ここ, そこ, あそこ |

Total: ~75 core words across 10 lessons.

### Word Introduction Format

Each word gets a rich embed:

```
┌──────────────────────────────────────────┐
│  Lesson 1: Greetings      [3/8]         │
│                                          │
│  すみません                               │
│  sumimasen                               │
│                                          │
│  Meaning: Excuse me / I'm sorry          │
│                                          │
│  📝 Example:                             │
│  すみません、えきはどこですか？              │
│  Sumimasen, eki wa doko desu ka?         │
│  "Excuse me, where is the station?"      │
│                                          │
│  🎌 Culture note:                        │
│  Japanese people use すみません constantly │
│  — to get attention, apologize, AND to   │
│  thank someone for going out of their    │
│  way. It's the Swiss Army knife of       │
│  Japanese politeness.                    │
│                                          │
│  [🔊 Hear It]  [Next →]                 │
└──────────────────────────────────────────┘
```

### Sentence Patterns

After vocabulary introduction, each lesson includes 2-3 sentence patterns taught through fill-in-the-blank exercises.

```
┌──────────────────────────────────────────┐
│  Pattern: ～は ～です                     │
│  "[Topic] is [description]"              │
│                                          │
│  Fill in the blank:                      │
│                                          │
│  わたし＿がくせいです。                     │
│  "I am a student."                       │
│                                          │
│  [は]  [が]  [を]  [に]                  │
└──────────────────────────────────────────┘
```

### Reading Exercises

Short passages using only known vocabulary, displayed with furigana:

```
┌──────────────────────────────────────────┐
│  📖 Reading Practice                     │
│                                          │
│  わたしは たなか です。                     │
│  がくせい です。                           │
│  にほんご を べんきょう して います。         │
│  コーヒー が すき です。                    │
│                                          │
│  ❓ Comprehension:                       │
│  What does Tanaka like?                  │
│                                          │
│  [Rice]  [Coffee]  [Tea]  [Fish]         │
└──────────────────────────────────────────┘
```

### Conversation Snippets

Mini-dialogues the user reads and then practices:

```
┌──────────────────────────────────────────┐
│  💬 At a Restaurant                      │
│                                          │
│  店員: いらっしゃいませ！                   │
│  Staff: Welcome!                         │
│                                          │
│  You: すみません、メニューをください。       │
│  You: Excuse me, the menu please.        │
│                                          │
│  店員: はい、どうぞ。                      │
│  Staff: Here you are.                    │
│                                          │
│  You: この ラーメン を ください。            │
│  You: This ramen, please.               │
│                                          │
│  店員: 800円です。                        │
│  Staff: That's 800 yen.                 │
│                                          │
│  [Practice This Dialogue]  [Next →]      │
└──────────────────────────────────────────┘
```

Clicking **[Practice This Dialogue]** starts an interactive mode where the bot plays the 店員 and the user types or speaks the learner's lines. The bot accepts approximate answers (romaji, partial kana, minor errors) and gently corrects.

### Stage 1 Quiz Format

Quizzes at the end of each lesson test all skills:

- **Vocab recall:** "What does おいしい mean?" (4 buttons)
- **Listening (if voice enabled):** Bot speaks a word, user picks the meaning
- **Fill-in-the-blank:** Sentence pattern with particle selection
- **Reading comprehension:** Short passage + question
- **Translation:** Simple English → Japanese (user types, bot evaluates)

Must score 70% to unlock next lesson. Failed questions re-enter the SRS system.

### Stage 1 Progression

```
Stage 1 Progress
████████████████░░░░ 80%  (8/10 lessons)

Lesson 1: Greetings        ⭐⭐⭐  (mastered)
Lesson 2: Self-Introduction ⭐⭐⭐  (mastered)
Lesson 3: Numbers           ⭐⭐    (proficient)
Lesson 4: Food & Drink      ⭐⭐    (proficient)
Lesson 5: Places            ⭐⭐    (proficient)
Lesson 6: Time              ⭐      (learning)
Lesson 7: Verbs             ⭐⭐    (proficient)
Lesson 8: Adjectives        ⭐      (learning)
Lesson 9: Shopping          🔒     (locked)
Lesson 10: Directions       🔒     (locked)
```

Star ratings:
- 1 star: Passed the quiz (70%+)
- 2 stars: Passed with 85%+ or completed a review session with 90%+
- 3 stars: All vocab from this lesson is "learned" in SRS (reviewed at least 3 times with "good" or "easy")

---

## Stage 2: Immersion Ready

### Transition

Stage 2 activates when the user completes Stage 1 (all 10 lessons passed). The bot sends a graduation message:

```
┌──────────────────────────────────────────┐
│  🎓 Stage 1 Complete!                    │
│                                          │
│  You know ~75 words, basic particles,    │
│  and can handle simple conversations.    │
│                                          │
│  Welcome to Stage 2: Immersion Mode      │
│                                          │
│  What changes:                           │
│  • SRS reviews start (718 N5 words)      │
│  • I'll start mixing Japanese into our   │
│    regular conversations                 │
│  • Grammar lessons unlock                │
│  • Conversation practice sessions        │
│                                          │
│  Stage 2 never really "ends" — it's      │
│  how we talk from now on.               │
│                                          │
│  [Start SRS Reviews]                     │
│  [Set Daily Review Time]                 │
│  [Conversation Practice]                 │
└──────────────────────────────────────────┘
```

### N5 Vocabulary via SRS

The existing SRS system (`SRSManager` with FSRS algorithm, 718 N5 cards in `n5-vocab.json`) becomes the primary vocabulary acquisition tool. Changes for Stage 2:

- **Automatic daily reviews:** Integrated with the reminder system. User sets a preferred time. Bot DMs them with due cards.
- **Button-based grading:** Instead of requiring the `srs_rate` tool via Claude, cards get interactive buttons:

```
┌──────────────────────────────────────────┐
│  📚 Daily Review            [3/10]       │
│                                          │
│  食[た]べる                               │
│                                          │
│  [Show Answer]                           │
└──────────────────────────────────────────┘
```

After clicking **[Show Answer]**:

```
┌──────────────────────────────────────────┐
│  📚 Daily Review            [3/10]       │
│                                          │
│  食[た]べる                               │
│  taberu — to eat                         │
│                                          │
│  How well did you remember?              │
│                                          │
│  [Again] [Hard] [Good] [Easy]            │
│  1min    8min   1day   4days             │
└──────────────────────────────────────────┘
```

Button customId scheme:
```
learn:srs:show:<cardId>
learn:srs:rate:<cardId>:<rating>
```

All handled via `registerButtonHandler("learn", ...)` — no Claude roundtrip.

### Grammar Patterns

Grammar is introduced through example conversations, not abstract rules. Each grammar point follows:

1. **Context:** A natural conversation using the pattern
2. **Spotlight:** The pattern highlighted and explained
3. **Practice:** 3 fill-in-the-blank exercises
4. **Production:** User writes their own sentence using the pattern

Grammar topics for Stage 2 (N5 level):

| # | Pattern | Example |
|---|---------|---------|
| 1 | ～は ～です (topic + copula) | わたしは がくせいです |
| 2 | Particles: は, が, を, に, で, へ | がっこうに いきます |
| 3 | ～ます / ～ません (polite verb forms) | たべます / たべません |
| 4 | ～ました / ～ませんでした (past tense) | きのう いきました |
| 5 | ～たい (want to) | すしを たべたいです |
| 6 | ～ている (progressive/state) | ほんを よんでいます |
| 7 | ～てください (please do) | みずを ください |
| 8 | ～てもいい (permission) | ここで たべてもいいですか |
| 9 | ～ないでください (please don't) | ここで たべないでください |
| 10 | ～から / ～まで (from/until) | 9じから 5じまで |
| 11 | ～とき (when) | ひまなとき えいがを みます |
| 12 | Question words: なに, だれ, どこ, いつ, なぜ, どう | なにを たべますか |

### Conversation Practice Sessions

The user can start a topic-based conversation practice. The bot sets the scene and plays a conversational partner.

```
┌──────────────────────────────────────────┐
│  💬 Conversation Practice                │
│                                          │
│  Pick a topic:                           │
│                                          │
│  [Weather] [Hobbies] [Daily Routine]     │
│  [Shopping] [Restaurant] [Directions]    │
│  [Self-Introduction] [Free Talk]         │
└──────────────────────────────────────────┘
```

During conversation practice:
- The bot speaks in simple Japanese appropriate to the user's level
- Unknown words are shown with furigana and a hover-style explanation (spoiler tags)
- The bot gently corrects errors inline (not in a separate correction block)
- After 5-10 exchanges, the bot summarizes what went well and what to review

---

## Passive Tutoring Mode

### Concept

Once a user reaches Stage 2, the bot's regular personality stays the same, but it naturally weaves Japanese into conversations. This is not a mode the user switches on — it is the default behavior once the learning profile reaches Stage 2.

### Activation Rules

Passive tutoring activates when ALL of these are true:
1. User has a learning profile at Stage 2+
2. User has `passive_tutoring` setting enabled (default: on after reaching Stage 2)
3. The conversation is in DMs or a channel where the bot is active

The user can disable it: "stop teaching me" / "English only" / button in `/learn settings`.

### Japanese Mixing Strategy

The bot introduces Japanese gradually, based on a **comprehension confidence score** (0-100) tracked per user:

| Confidence | Behavior |
|-----------|----------|
| 0-20 | Single Japanese words sprinkled in, always with English: "That's すごい (amazing)!" |
| 20-40 | Short phrases: "ああ、そうだね (yeah, that's right)! That reminds me..." |
| 40-60 | Full simple sentences with translation: "今日は天気がいいね！ (Nice weather today!)" |
| 60-80 | Japanese-first with English fallback: "明日何する？ Oh, what are you doing tomorrow?" |
| 80-100 | Primarily Japanese. English only for complex/new concepts. |

### Confidence Score Adjustment

The confidence score changes based on user behavior:

| Signal | Adjustment |
|--------|-----------|
| User responds in Japanese correctly | +2 |
| User responds in Japanese with minor errors | +1 |
| User asks "what does X mean?" | -1 |
| User says "I don't understand" / confused emoji | -3 |
| User responds only in English after Japanese prompt | -1 |
| User passes an SRS review session (80%+) | +1 |
| User fails an SRS review session (<50%) | -2 |
| 7-day study streak active | +5 (one-time per streak milestone) |

The score is stored in the user's learning profile in SQLite and updated after each interaction.

### Correction Style

When the user attempts Japanese, the bot corrects **inline and gently**, staying in persona:

> **User:** きのう がっこう に いった です
>
> **Bot (Taiga persona):** Hmm, close! But it's 「いきました」not 「いったです」— past tense with です uses ます form, dummy. 「きのう がっこうに いきました。」 ... Anyway, 学校[がっこう] how was school?

Correction principles:
- Never just say "wrong." Always show the correct form AND explain why.
- Maximum 1-2 corrections per message. If there are 5 errors, pick the most important ones. Don't overwhelm.
- Praise what they got right before correcting.
- Use the existing tutor prompt structure (from `buildTutorPrompt()`) to calibrate correction depth by level.

### Vocabulary Introduction (Passive)

New words are introduced naturally in conversation, not via flashcard-style presentation:

> **Bot:** Ugh, it's so 暑[あつ]い (hot) today... 夏[なつ] (summer) is the worst. Do you like 夏[なつ]?

When the bot uses a new word the user hasn't seen before:
1. Show it with furigana the first time
2. Add it to the user's SRS deck as a new card (if not already present)
3. Use it again naturally within the next few conversations
4. After 3 natural exposures, test recall by using the word without furigana

### Backing Off

The bot detects frustration/confusion through:
- Explicit requests: "English please", "I don't get it", "too hard"
- Behavioral signals: User stops responding, sends only short English replies after Japanese prompts, reacts with confused emoji
- SRS performance: Multiple "again" ratings in a row

When frustration is detected:
1. Immediately switch back to mostly English
2. Lower the confidence score by 5-10 points
3. Acknowledge it: "No worries, let's take it easy for now~"
4. Wait for the user to re-engage with Japanese before ramping back up

---

## Gamification System

### XP (Experience Points)

Every learning activity awards XP:

| Activity | XP |
|----------|-----|
| Complete a kana lesson (intro + practice) | 20 |
| Pass a kana quiz (4/5+) | 50 |
| Pass a boss round | 200 |
| Complete a Stage 1 vocabulary lesson | 30 |
| Pass a Stage 1 quiz | 60 |
| SRS review session (per card, "good" or "easy") | 5 |
| SRS review session (per card, "hard") | 3 |
| SRS review session (per card, "again") | 1 |
| Grammar lesson completed | 40 |
| Conversation practice session (5+ exchanges) | 50 |
| Daily login (open any learning feature) | 10 |
| Correct a previously missed question | 15 |
| Voice pronunciation practice (correct) | 10 |
| Use Japanese in regular conversation | 5 |

### Levels

XP thresholds with themed titles:

| Level | XP Required | Title |
|-------|-------------|-------|
| 1 | 0 | はじめまして (Nice to meet you) |
| 2 | 100 | あいうえお Apprentice |
| 3 | 300 | Kana Cadet |
| 4 | 600 | Word Collector |
| 5 | 1,000 | Sentence Builder |
| 6 | 1,500 | Grammar Geek |
| 7 | 2,500 | Conversation Starter |
| 8 | 4,000 | 日本語 Explorer |
| 9 | 6,000 | Immersion Diver |
| 10 | 10,000 | 日本語の達人 (Japanese Master) |

Level-ups trigger a special embed with the persona celebrating (reluctantly, if tsundere):

```
┌──────────────────────────────────────────┐
│  🎉 LEVEL UP!                            │
│                                          │
│  Level 4 → Level 5: Sentence Builder     │
│  Total XP: 1,050                         │
│                                          │
│  "Hmph, you're actually not completely   │
│   terrible at this. ...Don't let it go   │
│   to your head!"                         │
│                                          │
│  New unlocks:                            │
│  🔓 Grammar Lesson 1                    │
│  🔓 Conversation Practice               │
└──────────────────────────────────────────┘
```

### Streaks

A study streak increments when the user completes at least one learning activity per day (UTC). Tracked in SQLite.

| Streak | Reward |
|--------|--------|
| 3 days | +10 bonus XP per day |
| 7 days | "Week Warrior" badge, +20 bonus XP per day |
| 14 days | "Fortnight Fighter" badge |
| 30 days | "Monthly Master" badge, +50 bonus XP per day |
| 100 days | "Century Samurai" badge |
| 365 days | "Year of the Dragon" badge |

Streak is displayed in the daily review embed and on the `/learn` status page.

Streak protection: If the user misses a day, the bot sends a DM the next day: "Your 12-day streak is about to break! Do a quick review to keep it going." (Uses the existing reminder system.) If they miss two consecutive days, the streak resets to 0 but a "best streak" record is kept.

### Achievements

One-time unlockable badges stored per-user:

| Achievement | Condition | XP Bonus |
|-------------|----------|----------|
| First Steps | Complete first kana lesson | 10 |
| Hiragana Master | Pass hiragana boss round | 100 |
| Katakana Master | Pass katakana boss round | 100 |
| Kana Champion | Both hiragana + katakana mastered | 200 |
| Survival Speaker | Complete all Stage 1 lessons | 300 |
| SRS Rookie | Review 50 cards | 50 |
| SRS Veteran | Review 500 cards | 200 |
| SRS Legend | Review 5000 cards | 500 |
| Chatterbox | Complete 10 conversation practice sessions | 150 |
| Grammar Guru | Complete all N5 grammar lessons | 200 |
| Perfect Quiz | Score 100% on any quiz | 50 |
| Speed Demon | Answer 10 quiz questions in under 3 seconds each | 100 |
| Voice Actor | Complete 20 pronunciation practice rounds | 100 |
| Night Owl | Study after midnight (local time) | 20 |
| Early Bird | Study before 7am (local time) | 20 |

Achievements are shown as a badge wall in `/learn profile`:

```
┌──────────────────────────────────────────┐
│  🏆 Achievements (7/15)                  │
│                                          │
│  ✅ First Steps                          │
│  ✅ Hiragana Master                      │
│  ✅ Katakana Master                      │
│  ✅ Kana Champion                        │
│  ✅ SRS Rookie                           │
│  ✅ Perfect Quiz                         │
│  ✅ Night Owl                            │
│  🔒 Survival Speaker                    │
│  🔒 SRS Veteran (127/500 cards)         │
│  🔒 Chatterbox (3/10 sessions)          │
│  ...                                     │
└──────────────────────────────────────────┘
```

### Leaderboard (Server)

For servers with multiple learners. Ranked by XP, shown via `/learn leaderboard`:

```
┌──────────────────────────────────────────┐
│  📊 Japanese Leaderboard                 │
│                                          │
│  🥇 @UserA    Level 7  — 3,200 XP  🔥14│
│  🥈 @UserB    Level 5  — 1,400 XP  🔥7 │
│  🥉 @UserC    Level 4  — 800 XP    🔥3  │
│  4. @UserD    Level 3  — 450 XP         │
│  5. @UserE    Level 2  — 150 XP    🔥1  │
│                                          │
│  Your rank: #2                           │
└──────────────────────────────────────────┘
```

---

## Discord-Native Features

### Slash Commands

New commands added by the language-learning plugin:

| Command | Description |
|---------|-------------|
| `/learn` | Main entry point. Shows current status or starts onboarding. |
| `/learn review` | Start an SRS review session (button-based, no Claude). |
| `/learn lesson` | Continue current lesson or show lesson menu. |
| `/learn profile` | Show XP, level, streak, achievements. |
| `/learn leaderboard` | Server leaderboard. |
| `/learn settings` | Toggle passive tutoring, set review time, set timezone. |
| `/learn reset` | Reset progress (confirmation required). |

These are registered via `registerCommand()` in `lib/interactions.ts` and auto-deployed.

### Scheduled Daily Reviews

Integration with the existing `ReminderScheduler`:

When the user sets a daily review time (via `/learn settings` or during onboarding), the plugin creates a recurring reminder:
- Cron: `daily`
- Category: `srs-review`
- Message: triggers the SRS review flow (sends the first card embed with buttons)

The reminder callback checks how many cards are due and sends the review embed directly (no Claude roundtrip). If no cards are due, it sends a quick "Nothing to review today! Keep up the streak." message.

### Word of the Day

A scheduled daily embed sent to opted-in channels or DMs:

```
┌──────────────────────────────────────────┐
│  📖 Word of the Day                      │
│                                          │
│  大丈夫 (だいじょうぶ)                     │
│  daijoubu                                │
│                                          │
│  Meaning: okay, all right, fine          │
│  Level: JLPT N5                          │
│                                          │
│  Example:                                │
│  大丈夫[だいじょうぶ]ですか？               │
│  "Are you okay?"                         │
│                                          │
│  🎌 This is one of the most useful words │
│  in Japanese. Use it to ask if someone   │
│  is okay, or to say you're fine.         │
│                                          │
│  [Add to SRS]  [🔊 Hear It]             │
└──────────────────────────────────────────┘
```

Word selection: Prioritize words the user hasn't seen, weighted toward their current level. Falls back to interesting/useful words if all level-appropriate words are in SRS.

### Study Streak Tracking

Streak data displayed as a fire emoji counter on all learning embeds. Streak badges shown in profile.

Streak reminders use the existing reminder system:
- If the user hasn't studied by 8pm (their timezone), send a gentle nudge
- "You haven't studied today! Quick 5-card review to keep your 🔥12 streak?"
- Includes a **[Quick Review]** button that starts a 5-card SRS session

### Rich Embed Flashcards

SRS cards use embeds with:
- Color-coded borders (green = easy, yellow = learning, red = overdue)
- Furigana for all kanji
- Example sentence (hidden behind spoiler until answer is shown)
- Card statistics (times reviewed, current interval, ease factor)

---

## Voice Integration

Voice features require the `voice` plugin to be enabled alongside `language-learning`. All voice features are optional enhancements.

### Pronunciation Practice

**Flow:**
1. User clicks **[Pronunciation Practice]** button on any character/word embed
2. Bot joins the user's voice channel (or uses existing connection)
3. Bot speaks the target word/phrase via TTS (`speak` tool)
4. Bot listens for the user's attempt via STT
5. Bot compares STT transcription to expected text
6. Results shown as an embed:

```
┌──────────────────────────────────────────┐
│  🎤 Pronunciation Practice               │
│                                          │
│  Target: すみません (sumimasen)           │
│  You said: すみません                     │
│                                          │
│  ✅ Match! Nice pronunciation!           │
│  +10 XP                                  │
│                                          │
│  [Try Another]  [Back to Lesson]         │
└──────────────────────────────────────────┘
```

For mismatches:

```
┌──────────────────────────────────────────┐
│  🎤 Pronunciation Practice               │
│                                          │
│  Target: つ (tsu)                        │
│  You said: す (su)                       │
│                                          │
│  ❌ Close! つ uses the tongue tip more   │
│  forward. Try "tsoo" not "soo".         │
│                                          │
│  [🔊 Hear Again]  [Try Again]  [Skip]   │
└──────────────────────────────────────────┘
```

### Listening Quiz

1. Bot speaks a Japanese word/phrase via TTS (no text shown)
2. User types what they heard in the text channel (hiragana, katakana, or romaji accepted)
3. Bot evaluates using kana conversion (`wanakana`) to normalize input

```
┌──────────────────────────────────────────┐
│  👂 Listening Quiz                        │
│                                          │
│  I just said something in Japanese.      │
│  Type what you heard!                    │
│                                          │
│  (Hint: it's a greeting)                │
│                                          │
│  [🔊 Hear Again]  [Give Up]             │
└──────────────────────────────────────────┘
```

### Conversation Practice (Voice)

Full voice conversation using the existing voice pipeline:
1. User joins VC and starts a conversation topic
2. Bot responds in simple Japanese (calibrated to level)
3. User speaks in Japanese
4. STT transcribes, the AI evaluates and responds
5. TTS speaks the response
6. After the session, a summary embed shows corrections and new words learned

### Shadowing Mode

1. Bot speaks a sentence at normal speed via TTS
2. Short pause (1-2 seconds)
3. User repeats the sentence
4. STT captures and compares
5. If correct, speed increases slightly for the next sentence
6. If incorrect, the bot re-speaks at slower speed

```
┌──────────────────────────────────────────┐
│  🔁 Shadowing Practice                   │
│                                          │
│  Speed: Normal (1.0x)                    │
│  Streak: 5 correct in a row             │
│                                          │
│  Listening...                            │
│                                          │
│  [Pause]  [Slower]  [Stop]              │
└──────────────────────────────────────────┘
```

---

## Data Requirements

### Hiragana/Katakana Chart Data

A structured JSON file with all kana, their readings, mnemonics, stroke counts, and example words.

**File:** `packages/tutor/languages/japanese/data/kana-chart.json`

```json
{
  "hiragana": {
    "rows": [
      {
        "name": "あ行",
        "nameEn": "Vowels",
        "lesson": 1,
        "characters": [
          {
            "char": "あ",
            "romaji": "a",
            "mnemonic": "A person doing a yoga pose, saying 'Ahhh~'",
            "strokeCount": 3,
            "strokeHint": "Horizontal → diagonal → curved sweep",
            "exampleWord": "あめ",
            "exampleReading": "ame",
            "exampleMeaning": "rain"
          }
        ]
      }
    ],
    "dakuten": [ ... ],
    "youon": [ ... ]
  },
  "katakana": { ... }
}
```

**Existing asset:** The `HIRAGANA` and `KATAKANA` arrays in `languages/japanese/index.ts` have the character-romaji mappings. These need to be extended with mnemonics, stroke data, and example words.

### Core Vocabulary Lists

**Existing asset:** `n5-vocab.json` (718 cards with front/back/reading/tags).

**New data needed:**
- `packages/tutor/languages/japanese/data/survival-vocab.json` — The 75 Stage 1 words with thematic grouping, example sentences, and cultural notes.
- `packages/tutor/languages/japanese/data/grammar-patterns.json` — N5 grammar patterns with explanations, examples, and practice exercises.
- `packages/tutor/languages/japanese/data/conversation-scripts.json` — Dialogue scripts for conversation practice scenarios.

### Sentence Pattern Templates

Stored in the grammar patterns data file. Each pattern includes:
- Pattern name (Japanese + English)
- Explanation
- 3-5 example sentences with translations
- 3 fill-in-the-blank exercises with options and correct answers
- Common mistakes to watch for

### Mnemonic Data

The hiragana/katakana mnemonics are critical for Stage 0 effectiveness. Each character needs a memorable visual or story association. These should be curated by hand (or generated and reviewed), not auto-generated at runtime.

---

## Database Schema

All learning state moves from in-memory (`session.ts`'s `Map`) to SQLite. The database lives at `${DATA_DIR}/language-learning.db` (same pattern as `srs.db`).

### Tables

```sql
-- User learning profile (replaces in-memory session)
CREATE TABLE learner_profiles (
  user_id TEXT PRIMARY KEY,
  language TEXT DEFAULT 'japanese',
  level TEXT DEFAULT 'N5',
  stage INTEGER DEFAULT 0,           -- 0, 1, or 2
  xp INTEGER DEFAULT 0,
  learner_level INTEGER DEFAULT 1,   -- gamification level (1-10)
  confidence_score INTEGER DEFAULT 0, -- passive tutoring (0-100)
  passive_tutoring INTEGER DEFAULT 0, -- 0=off, 1=on
  timezone TEXT DEFAULT 'UTC',
  streak_current INTEGER DEFAULT 0,
  streak_best INTEGER DEFAULT 0,
  streak_last_date TEXT,             -- YYYY-MM-DD of last study activity
  review_time TEXT,                  -- preferred daily review time (HH:MM)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Kana lesson progress
CREATE TABLE kana_progress (
  user_id TEXT NOT NULL,
  script TEXT NOT NULL,              -- 'hiragana' or 'katakana'
  row_name TEXT NOT NULL,            -- 'あ行', 'か行', etc.
  lesson_num INTEGER NOT NULL,
  phase TEXT DEFAULT 'locked',       -- 'locked', 'intro', 'practice', 'quiz', 'complete'
  quiz_score INTEGER,                -- best quiz score (out of 5)
  quiz_attempts INTEGER DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (user_id, script, row_name)
);

-- Stage 1 lesson progress
CREATE TABLE vocab_lesson_progress (
  user_id TEXT NOT NULL,
  lesson_id INTEGER NOT NULL,
  theme TEXT NOT NULL,
  stars INTEGER DEFAULT 0,           -- 0-3
  quiz_best_score REAL,              -- 0.0-1.0
  quiz_attempts INTEGER DEFAULT 0,
  words_introduced INTEGER DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (user_id, lesson_id)
);

-- Grammar lesson progress
CREATE TABLE grammar_progress (
  user_id TEXT NOT NULL,
  pattern_id INTEGER NOT NULL,
  completed INTEGER DEFAULT 0,
  practice_score REAL,
  completed_at TEXT,
  PRIMARY KEY (user_id, pattern_id)
);

-- Achievements
CREATE TABLE achievements (
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, achievement_id)
);

-- Activity log (for streak tracking and analytics)
CREATE TABLE study_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,       -- 'kana_lesson', 'vocab_lesson', 'srs_review', 'conversation', 'grammar', 'pronunciation'
  xp_earned INTEGER DEFAULT 0,
  details TEXT,                      -- JSON blob with activity-specific data
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_activity_user_date ON study_activity(user_id, created_at);

-- Active lesson sessions (for resuming mid-lesson)
CREATE TABLE active_sessions (
  user_id TEXT PRIMARY KEY,
  session_type TEXT NOT NULL,        -- 'kana_intro', 'kana_practice', 'kana_quiz', 'vocab_lesson', 'srs_review', 'grammar', 'conversation'
  session_data TEXT NOT NULL,        -- JSON blob with full session state
  message_id TEXT,                   -- Discord message ID of the current embed (for editing)
  channel_id TEXT,                   -- Discord channel ID
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Leaderboard cache (materialized view, rebuilt periodically)
CREATE TABLE leaderboard_cache (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp INTEGER DEFAULT 0,
  learner_level INTEGER DEFAULT 1,
  streak_current INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, user_id)
);
```

### Migration Strategy

On plugin init, check if `language-learning.db` exists. If not, create it with all tables. If it exists, run migrations by checking a `schema_version` pragma or a `_migrations` table. This follows the same pattern as `SRSManager.init()`.

The existing in-memory `sessions` Map in `session.ts` becomes a read-through cache backed by `learner_profiles`.

---

## Technical Architecture

### Interaction Handler Registration

The language-learning plugin registers button handlers via `registerButtonHandler("learn", handler)` in its `onInteraction` hook. The handler routes based on the second segment of the customId:

```typescript
// In packages/tutor/interactions.ts
registerButtonHandler("learn", async (interaction, parts, ctx) => {
  const [_, section, action, ...rest] = parts;
  // section: "onboard", "kana", "srs", "vocab", "grammar", "profile"

  switch (section) {
    case "onboard": return handleOnboarding(interaction, action, rest, ctx);
    case "kana": return handleKanaInteraction(interaction, action, rest, ctx);
    case "srs": return handleSRSInteraction(interaction, action, rest, ctx);
    case "vocab": return handleVocabInteraction(interaction, action, rest, ctx);
    // ...
  }
});
```

### No Claude Roundtrip for Quizzes

All quiz interactions (button clicks for answers, SRS ratings, lesson navigation) are handled directly by the button handler code. The handler:

1. Reads the session state from SQLite (or in-memory cache)
2. Evaluates the answer
3. Updates the session state
4. Edits the Discord embed with the result
5. Sends the next question embed (or results)

This keeps response time under 100ms, critical for a game-like quiz experience. Claude is only involved for:
- Free-text conversation practice (needs AI evaluation)
- Passive tutoring corrections (happens within normal message flow)
- Grammar explanations beyond templates

### Session Persistence

Active sessions (mid-lesson state) are stored in the `active_sessions` table. The session data is a JSON blob containing everything needed to resume:

```typescript
interface KanaQuizSession {
  type: "kana_quiz";
  lessonId: number;
  script: "hiragana" | "katakana";
  questions: Array<{
    character: string;
    correctAnswer: string;
    options: string[];
    answered?: boolean;
    userAnswer?: string;
    correct?: boolean;
  }>;
  currentQuestion: number;
  score: number;
  startedAt: string;
}
```

When a user clicks a button, the handler loads the session, updates it, saves it back, and edits the embed. If the session is stale (no interaction for 30+ minutes), it is treated as abandoned and the user can restart.

### Timer-Based Quiz Countdown

The 10-second countdown on quiz questions is handled by:
1. When the question embed is sent, record `Date.now() + 10000` in the session
2. When a button click arrives, check if the deadline has passed
3. If past deadline, treat as a timeout (wrong answer)
4. The visual timer bar in the embed is a static snapshot (e.g., `████████░░` for 8 seconds remaining). It does not live-update — Discord embeds cannot animate. The bar is set at send time to show the full timer.

To enforce the timeout: a `setTimeout` fires after 10 seconds and edits the embed to show "Time's up!" if no answer was received. This timeout is stored per-session and cleared when an answer arrives.

### Plugin File Structure (Proposed)

```
packages/tutor/
├── index.ts                    # Plugin entry (existing, add onInteraction hook)
├── tools.ts                    # MCP tools (existing)
├── srs.ts                      # SRS manager (existing)
├── srs-instance.ts             # SRS singleton (existing)
├── kana.ts                     # Kana conversion (existing)
├── session.ts                  # Session manager (refactor: SQLite-backed)
├── furigana.ts                 # Furigana engine (existing)
├── db.ts                       # NEW: SQLite database manager for learning state
├── interactions.ts             # NEW: Button/modal handler registration
├── gamification.ts             # NEW: XP, levels, streaks, achievements
├── onboarding.ts               # NEW: First-time flow + placement quiz
├── stages/
│   ├── kana.ts                 # NEW: Stage 0 lesson engine
│   ├── survival.ts             # NEW: Stage 1 lesson engine
│   └── immersion.ts            # NEW: Stage 2 passive tutoring logic
├── embeds.ts                   # NEW: Shared embed builders
├── scheduled.ts                # NEW: Daily review, word of the day, streak reminders
├── voice-exercises.ts          # NEW: Pronunciation, listening, shadowing
├── languages/
│   ├── types.ts                # Language module types (existing)
│   ├── index.ts                # Language registry (existing)
│   └── japanese/
│       ├── index.ts            # Japanese module (existing)
│       ├── dictionary.ts       # Jisho API (existing)
│       └── data/
│           ├── n5-vocab.json   # SRS deck (existing, 718 cards)
│           ├── kana-chart.json # NEW: Full kana with mnemonics
│           ├── survival-vocab.json  # NEW: Stage 1 themed vocabulary
│           ├── grammar-patterns.json # NEW: N5 grammar patterns
│           └── conversation-scripts.json # NEW: Dialogue scripts
```

### Integration Points

| Feature | Existing System | Integration |
|---------|----------------|-------------|
| SRS reviews | `SRSManager` in `srs.ts` | Button-based UI wraps existing `getDueCards()` / `reviewCard()` |
| Kana conversion | `kana.ts` (wanakana) | Used to normalize user input (romaji/kana/katakana all accepted) |
| Furigana | `furigana.ts` (kuroshiro) | Auto-add readings in embeds and passive tutoring |
| Dictionary | `dictionary.ts` (Jisho API) | Used in conversation practice for word explanations |
| Reminders | `ReminderScheduler` in `lib/reminders.ts` | Daily review scheduling, streak protection nudges |
| Voice TTS/STT | `packages/voice/` providers | Pronunciation practice, listening quizzes, shadowing |
| Button handlers | `registerButtonHandler()` in `lib/interactions.ts` | All quiz/lesson navigation |
| Slash commands | `registerCommand()` in `lib/interactions.ts` | `/learn` and subcommands |
| Config | `ConfigManager` in `lib/config.ts` | Plugin settings (enabled, global preferences) |

---

## Session & State Management

### Resumability

Users can close Discord mid-lesson and come back later. The `active_sessions` table stores the full state. When the user returns:

1. **Natural trigger:** User says "continue my lesson" or "let's study" — Claude loads the session and sends the current embed.
2. **Command trigger:** `/learn lesson` checks for an active session and resumes it.
3. **Button on stale embed:** If the user clicks a button on an old embed (e.g., from yesterday), the handler checks if the session is still valid. If yes, it resumes. If not, it prompts to start fresh.

### Session Expiry

Active sessions expire after 24 hours of inactivity. Expired sessions are cleaned up on next plugin init or next interaction from that user.

### Concurrent Session Prevention

A user can only have one active lesson session at a time. Starting a new lesson while one is active will prompt: "You have an unfinished lesson (Kana: か行). Continue it or start over?"

### State Recovery

If the bot restarts mid-lesson (worker restart via supervisor), the session state in SQLite survives. The Discord message reference (`message_id`, `channel_id`) allows the bot to edit the existing embed rather than sending a new one. If the message is too old to edit (Discord limit), a new embed is sent with a note: "Picking up where we left off!"

---

## Example Embed Layouts

### Daily Status Dashboard (`/learn`)

```
┌──────────────────────────────────────────┐
│  📚 Japanese Learning — @User            │
│                                          │
│  Level 5: Sentence Builder               │
│  XP: 1,050 / 1,500                      │
│  ████████████████████░░░░░░░░ 70%       │
│                                          │
│  🔥 Streak: 12 days                     │
│  📊 Stage: 2 (Immersion)                │
│  🎯 SRS: 15 cards due                   │
│  🏆 Achievements: 7/15                   │
│                                          │
│  Today:                                  │
│  ✅ Daily login (+10 XP)                 │
│  ⬜ SRS review (15 due)                 │
│  ⬜ Grammar lesson 5                    │
│                                          │
│  [Start Review] [Continue Lesson]        │
│  [Conversation Practice] [Profile]       │
└──────────────────────────────────────────┘
```

### SRS Review Session (Button-Based)

```
┌──────────────────────────────────────────┐
│  📚 Review          [7/15]    🔥12      │
│                                          │
│  ┌────────────────────────────────┐      │
│  │                                │      │
│  │         食[た]べる              │      │
│  │         taberu                 │      │
│  │                                │      │
│  │     to eat                     │      │
│  │                                │      │
│  │  Example: 朝ごはんを食べる      │      │
│  │  "To eat breakfast"            │      │
│  └────────────────────────────────┘      │
│                                          │
│  Reviews: 3 | Interval: 4 days          │
│                                          │
│  [Again] [Hard] [Good] [Easy]            │
│  1min    8min   4days  12days            │
└──────────────────────────────────────────┘
```

### Kana Lesson Introduction

```
┌──────────────────────────────────────────┐
│  Lesson 2: か行      ひらがな    [2/5]  │
│                                          │
│  ┌────────────────────────────────┐      │
│  │              き                │      │
│  │             /ki/               │      │
│  └────────────────────────────────┘      │
│                                          │
│  🧠 Mnemonic:                            │
│  Looks like a KEY — and it starts with   │
│  "ki" like "key"!                        │
│                                          │
│  ✏️ Strokes: 4                           │
│  Two horizontals, one vertical with      │
│  a curved tail                           │
│                                          │
│  📝 きく (kiku) = to listen              │
│                                          │
│  ░█░░░░░░░░░░░░░░░░░░ 8% of ひらがな    │
│                                          │
│  [🔊 Hear It]  [← Back]  [Next →]       │
└──────────────────────────────────────────┘
```

### Conversation Practice

```
┌──────────────────────────────────────────┐
│  💬 At a Convenience Store               │
│                                          │
│  🏪 Setting: You're buying a bento for   │
│  lunch at a konbini.                     │
│                                          │
│  店員[てんいん]: いらっしゃいませ！          │
│  (Staff: Welcome!)                       │
│                                          │
│  Type your response in Japanese!         │
│  Hint: You want to buy this bento (この)  │
│  and ask the price (いくら)               │
│                                          │
│  Accepted: hiragana, katakana, or romaji │
│                                          │
│  [🔊 Hear Dialogue]  [💡 Hint]  [Skip]  │
└──────────────────────────────────────────┘
```

### Achievement Unlock

```
┌──────────────────────────────────────────┐
│  🏆 Achievement Unlocked!                │
│                                          │
│  ⭐ KANA CHAMPION ⭐                     │
│  Mastered both hiragana AND katakana     │
│                                          │
│  +200 XP bonus!                          │
│                                          │
│  "Fine, I GUESS you're not totally       │
│   hopeless. You can read kana now.       │
│   ...Don't look at me like that!"        │
│                                          │
│  6/15 achievements unlocked              │
└──────────────────────────────────────────┘
```

---

## Implementation Priority

Suggested build order, each phase is independently shippable:

### Phase A: Foundation (Core Infrastructure)
1. `db.ts` — SQLite database manager with all tables
2. `session.ts` refactor — SQLite-backed profiles replacing in-memory Map
3. `interactions.ts` — Button handler registration
4. `embeds.ts` — Shared embed builders
5. `gamification.ts` — XP, levels, streak tracking

### Phase B: Stage 0 (Kana)
1. `kana-chart.json` — Full data file with mnemonics
2. `stages/kana.ts` — Lesson engine (intro, practice, quiz, boss)
3. `onboarding.ts` — Level assessment flow
4. Wire into plugin `onInteraction`

### Phase C: Stage 1 (Survival)
1. `survival-vocab.json` — Themed vocabulary data
2. `grammar-patterns.json` — N5 grammar with exercises
3. `stages/survival.ts` — Lesson engine
4. Reading exercises, conversation snippets

### Phase D: Stage 2 (Immersion)
1. `stages/immersion.ts` — Passive tutoring logic
2. Confidence score tracking
3. SRS button-based review UI
4. `scheduled.ts` — Daily reviews, word of the day, streak nudges

### Phase E: Voice
1. `voice-exercises.ts` — Pronunciation, listening, shadowing
2. Integration with voice plugin TTS/STT
3. Voice-enhanced quizzes

### Phase F: Social
1. Leaderboard system
2. Achievement badges display
3. Server-wide stats
