# Tutor Plugin — Generalized Teaching Harness

> Status: Phase 1 complete, Phase 2 specced (structured lesson system)
> Date: 2026-03-31 (Phase 1), 2026-04-01 (Phase 2 spec)

## Vision

A modular tutor plugin that can teach **anything** — not just languages. The existing language-learning plugin becomes one module inside a broader teaching harness.

## Current State (Language Learning Plugin)

What we already have:
- **SRS engine** (FSRS algorithm via `ts-fsrs`) — already language-agnostic
- **Language module interface** — pluggable per-language implementations
- **Per-user sessions** — level tracking, language selection (in-memory)
- **11 MCP tools** — tutoring, quizzes, SRS, dictionary, kana conversion
- **SQLite storage** — SRS cards with FSRS scheduling
- **718 JLPT N5 cards** — auto-imported on first review

### What works well (keep)
- FSRS spaced repetition — proven algorithm, works for any flashcard content
- Plugin interface pattern — clean init/destroy/tools lifecycle
- Per-user isolation — all data keyed by Discord user ID
- Tool colocations — schema + handler in one file

### What needs generalizing
- Session management (currently language-specific: `language` + `level`)
- Quiz generation (hardcoded Japanese grammar questions)
- Dictionary lookup (Jisho API only)
- Kana/furigana utilities (Japanese-specific)
- Tutor prompts (JLPT level-specific)
- Card import (N5 vocab JSON only)

## Proposed Architecture

```
plugins/tutor/
├── index.ts                    # Plugin entry — discovers + loads modules
├── core/
│   ├── srs.ts                  # FSRS engine (extracted, unchanged)
│   ├── session.ts              # Generalized per-user session
│   ├── quiz.ts                 # Quiz framework (multiple question types)
│   └── types.ts                # TutorModule interface, shared types
├── tools/
│   ├── srs-tools.ts            # review, rate, stats (module-agnostic)
│   ├── tutor-tools.ts          # tutor_prompt, quiz, set_level
│   ├── module-tools.ts         # list/switch modules
│   └── index.ts                # Tool registry
└── modules/
    ├── index.ts                # Module registry (auto-discover)
    ├── japanese/               # Migrated from language-learning
    │   ├── index.ts
    │   ├── dictionary.ts       # Jisho API
    │   ├── kana.ts
    │   ├── furigana.ts
    │   └── data/n5-vocab.json
    ├── chinese/                # Future
    ├── math/                   # Future — arithmetic, algebra, calculus
    ├── programming/            # Future — syntax, concepts, challenges
    └── trivia/                 # Future — general knowledge
```

## TutorModule Interface

```typescript
interface TutorModule {
  // Identity
  name: string;                          // e.g. "japanese", "math", "programming"
  displayName: string;                   // e.g. "Japanese", "Mathematics"
  description: string;                   // Short description for listing
  icon?: string;                         // Emoji for UI

  // Levels
  levels: string[];                      // e.g. ["N5","N4","N3"] or ["beginner","intermediate","advanced"]
  defaultLevel: string;

  // Core capabilities (all optional — modules implement what makes sense)
  buildTutorPrompt?(level: string): string;
  generateQuiz?(level: string, type: string): QuizQuestion;
  lookup?(query: string): Promise<LookupResult[]>;

  // SRS card source
  getDecks?(): DeckInfo[];               // Available card decks
  importDeck?(deckId: string): Card[];   // Import cards for SRS

  // Module-specific tools (auto-registered)
  tools?: ToolDef[];                     // e.g. convert_kana for Japanese

  // Lifecycle
  init?(): Promise<void>;
  destroy?(): Promise<void>;
}
```

## Capability Matrix

What each module type might implement:

| Capability | Japanese | Chinese | Math | Programming | Trivia |
|-----------|----------|---------|------|-------------|--------|
| Tutor prompt | Yes | Yes | Yes | Yes | No |
| Dictionary | Jisho | MDBG? | No | MDN/docs? | No |
| Quiz | Yes | Yes | Yes | Yes | Yes |
| SRS cards | JLPT decks | HSK decks | Formulas | Syntax | Facts |
| Special tools | Kana, furigana | Pinyin? | Calculator? | Code runner? | — |

## Generalized Session

```typescript
interface UserSession {
  activeModule: string;          // "japanese", "math", etc.
  moduleState: Record<string, {  // Per-module state
    level: string;
    settings?: Record<string, any>;
    lastActive?: string;
  }>;
}
```

## Quiz Framework

```typescript
interface QuizQuestion {
  type: string;                  // Module defines its own types
  prompt: string;                // The question
  options?: string[];            // Multiple choice (optional)
  answer: string;                // Correct answer
  explanation?: string;          // Why this is correct
  difficulty: string;            // Maps to module's level system
  tags?: string[];               // For filtering/categorization
}

// Modules register their quiz types:
// Japanese: "reading", "vocab", "grammar", "kanji"
// Math: "arithmetic", "algebra", "geometry"
// Programming: "syntax", "output", "debug"
```

## Migration Path

1. ~~Extract SRS engine from `language-learning/srs.ts` → `tutor/core/srs.ts`~~ ✅
2. ~~Create TutorModule interface~~ ✅
3. ~~Wrap existing Japanese code as a TutorModule~~ ✅
4. ~~Build the tutor plugin shell (module discovery, tool routing)~~ ✅
5. ~~Migrate language-learning tools to tutor tools~~ ✅
6. Add new modules incrementally

## Open Questions

- [x] ~~Should the language-learning plugin be replaced entirely?~~ Yes — tutor replaces it completely.
- [ ] How to handle module-specific Discord interactions (e.g. kana conversion only makes sense for Japanese)?
- [ ] Should modules be able to register their own slash commands?
- [ ] How to handle cross-module SRS (e.g. user studying both Japanese and math)?
- [ ] Web resources for non-language modules — what APIs/data sources?
- [ ] Voice integration — should tutor modules be able to hook into voice for pronunciation practice?

## Research TODO

- [x] Evaluate card deck formats (Anki `.apkg`, CSV, JSON) for universal import
- [x] Research quiz question banks / APIs for different subjects
- [x] Look into adaptive difficulty (beyond fixed levels)
- [x] Survey existing teaching/tutoring frameworks for architecture inspiration
- [x] Explore progress tracking / analytics (streaks, accuracy, time spent)
- [x] Research conversational tutoring patterns (Khanmigo, Duolingo Max)
- [x] Evaluate gamification approaches for Discord
- [x] Research language APIs (Chinese, Korean, multi-language dictionaries)
- [x] Research code execution sandboxes for programming module
- [x] Research math/science computation APIs

---

## Research Findings

### Anki Deck Import

We can support `.apkg` imports — the format is a ZIP containing SQLite + media.

| Library | npm | Notes |
|---------|-----|-------|
| **anki-reader** | `anki-reader` v0.3.0 | Reads `.apkg` and `.anki2`. Bun-compatible. Returns decks/cards/media. **Best fit.** |
| **anki-apkg-parser** | `anki-apkg-parser` v1.0.1 | Alternative. Uses SQLite directly. Custom queries supported. |
| **anki-apkg-export** | `anki-apkg-export` v4.0.3 | For generating `.apkg` files (export feature). |

**Strategy:** Let users upload `.apkg` files via Discord attachment → parse with `anki-reader` → import cards into our SRS SQLite DB. No AnkiWeb API exists, so user uploads are the way. Ship bundled decks for common subjects (like we already do with JLPT N5).

### Quiz APIs (Free)

| API | Focus | Key Details |
|-----|-------|-------------|
| **Open Trivia DB** | General knowledge | 4000+ questions. Free, no key. Science, Math, History, Geography, Computers. |
| **The Trivia API** | General (better categorization) | Free non-commercial. Subcategory filtering, difficulty levels. |
| **QuizAPI.io** | **Programming/tech** | PHP, JS, Python, Linux, DevOps, Docker, K8s. Free tier w/ API key. |
| **API Ninjas Trivia** | Mixed | Hundreds of thousands of questions. Free tier w/ key. |
| **Numbers API** | Math trivia | Number facts. No key needed. Good for math warmups. |

**Strategy:** QuizAPI.io for programming, Open Trivia DB for general knowledge, Claude-generated questions for anything custom or academic.

### SRS Algorithm Status

**ts-fsrs is still the best choice.** FSRS v6 is the latest (21 params, up from 19) — better short-term scheduling. ts-fsrs v5.3.2 is actively maintained by the official open-spaced-repetition org.

Alternatives considered:
- **LECTOR** (2025 paper) — LLM-enhanced repetition using semantic similarity to handle vocabulary confusion. No library exists, but the core idea (use Claude to identify confusable cards) could be layered on top of FSRS
- **fsrs-rs-nodejs** — Rust bindings, faster but unnecessary for our scale

### Adaptive Difficulty (Beyond Fixed Levels)

Recommended approach — simple, no ML infrastructure needed:

1. **Keep FSRS** for scheduling reviews (proven, optimal)
2. **Add Elo-based difficulty tracking** — rate both students and questions. After each answer, adjust both ratings. ~50 lines of code for adaptive difficulty
3. **Zone of Proximal Development (ZPD)** — for new questions (not SRS), pick ones where student's Elo predicts 60-80% success probability
4. **Claude semantic awareness** — when student gets a card wrong, ask Claude to identify confusable items in their deck → schedule targeted drills (LECTOR idea, free with our existing LLM)

| Approach | Complexity | Value | Notes |
|----------|-----------|-------|-------|
| Elo rating | ~50 LoC | High | Adaptive difficulty for free |
| ZPD selection | ~20 LoC | High | Keeps students in the learning zone |
| Claude confusion detection | Tool call | Medium | Leverages existing LLM |
| Bayesian Knowledge Tracing | Port needed | Medium | `pyBKT` exists in Python only |
| Deep Knowledge Tracing | Too heavy | Low | Needs training data + neural infra |

### Language APIs (Beyond Japanese)

| Language | Best API | Free? | Notes |
|----------|---------|-------|-------|
| **Chinese** | CC-CEDICT (local file) | Yes (CC BY-SA) | 120k+ entries. Download + parse locally. Format: `Traditional Simplified [pinyin] /English/`. Levels: HSK 1-6. |
| **Korean** | KRDICT API | Yes (50k req/day) | Official Korean Learners' Dictionary. 50k+ entries. Translations in EN/JP/FR/ES/ZH. |
| **Multi-language** | Lexicala API | 50 calls/day free | 50+ languages. Paid beyond free tier ($100/mo). |
| **English** | Free Dictionary API | Yes, fully free | Wiktionary-powered. Phonetics, meanings, examples, audio. No key needed. |
| **Translation** | LibreTranslate | Yes (self-hosted) | Open-source, Docker/pip. No API key when self-hosted. |

**Strategy:** Chinese → bundle CC-CEDICT locally. Korean → KRDICT API. European languages → Free Dictionary API + LibreTranslate. Only pay for Lexicala if we need 50+ languages.

### Code Execution Sandboxes (Programming Module)

| Tool | Self-hosted? | Free? | Languages | Notes |
|------|-------------|-------|-----------|-------|
| **Piston** | Yes | Fully free | 50+ | Lightweight, simple API (POST code, GET output). Best fit for Discord bot. |
| **Judge0** | Yes | Unlimited self-hosted | 60+ | More features (test-case judging, timeouts, memory limits). Heavier. Has MCP server. |
| **Cloudflare Sandbox** | No | Free tier | JS/TS | Good if we only need JS/TS. |

**Challenge sources:** LeetCode (unofficial GraphQL API, 3000+ problems), Exercism (82 languages, open-source on GitHub), Project Euler (math-heavy).

**Strategy:** Piston for code execution (lightweight, self-hosted). Import problem bank from LeetCode/Exercism rather than depending on live APIs.

### Math/Science APIs

| Tool | Free? | Step-by-step? | Notes |
|------|-------|---------------|-------|
| **Wolfram Alpha API** | 2000 calls/month | Yes | Gold standard. Algebra, calculus, step-by-step solutions, graphs. |
| **SymPy** (Python) | Fully free | Yes (programmatic) | Symbolic math. Can run as microservice. Unlimited usage. |
| **Newton API** | Self-hosted | No steps | Simple operations (derive, integrate, factor). Lightweight. |

**Strategy:** Wolfram Alpha for the free tier (2000/month is plenty). SymPy as fallback for unlimited usage. Claude itself is good at math explanations — APIs mainly for verification.

### Integration Priority

**High priority (easy wins):**
1. Open Trivia DB — zero-auth, instant quiz content
2. CC-CEDICT — bundle locally for Chinese module
3. KRDICT — free official API for Korean module
4. Anki .apkg import — `anki-reader` npm package
5. Wolfram Alpha — 2000 free calls/month for math

**Medium priority (more infrastructure):**
6. Piston — code execution (needs Docker)
7. LeetCode problem bank — import for coding challenges
8. LibreTranslate — self-hosted translation

**Lower priority (nice-to-have):**
9. Lexicala API — more languages
10. QTI importer — import from LMS platforms
11. SymPy microservice — unlimited math solving

### Existing Discord Education Bots — Lessons

No existing Discord bot combines AI tutoring + SRS + multi-subject. Key takeaways:
- Interactive quizzes with **buttons** are the most engaging feature (we have button infra)
- **Progress tracking/streaks** keep users coming back
- **Leaderboards** drive engagement in servers
- **Analytics/stats embeds** are highly valued by both learners and educators

### Active Recall Techniques (Beyond Flashcards)

The harness should support multiple question types, not just front/back cards:

| Technique | How It Works | Discord Implementation |
|-----------|-------------|----------------------|
| **Cloze deletion** | Hide word in sentence, learner fills gap | Bot sends `The ___ is the powerhouse of the cell`, user types answer |
| **Free recall** | "Write everything you remember about X" | Bot prompts topic, user dumps knowledge, Claude evaluates |
| **Elaborative interrogation** | "Why is this true?" / "How does this relate to X?" | Naturally conversational — bot asks follow-up why/how questions |
| **Feynman technique** | Explain concept simply, as if teaching a child | Bot says "explain X to me like I'm 10", Claude evaluates |
| **Error correction** | Bot presents text with deliberate errors, learner fixes them | Great for language + programming |
| **Sentence construction** | Given words, build a correct sentence | Bot provides words, user builds sentence |
| **Matching/ordering** | Match terms to definitions, put steps in order | Numbered responses or Discord buttons |
| **Context clues** | Sentence with unknown word, guess meaning from context | Great for vocabulary across all languages |

Key finding: Active recall produces 3-8x higher retention than passive review. Struggling to retrieve (even failing) strengthens memory more than re-reading.

### Gamification

What actually works long-term (not just PBL — points/badges/leaderboards):

**Daily hooks (habit formation):**
- Daily streak with visible counter + streak freeze option (users 2.3x more likely to engage after 7+ days)
- Daily challenge — one curated question/task (low commitment entry point)
- XP multiplier events — "Double XP Weekend" creates urgency

**Weekly engagement:**
- Weekly leagues/leaderboards with reset — fresh competition
- Weekly summary embed — "This week: 45 words learned, 120 cards reviewed, 87% accuracy"
- Friend challenges — "Challenge @user to a vocab duel"

**Long-term progression:**
- Level system with meaningful unlocks (new content, harder difficulty, Discord roles)
- Milestone badges for genuine achievements (100-day streak, 1000 cards mastered)
- Mastery visualization — topics marked as "mastered" / "learning" / "new"

**Discord-native features to leverage:**
- Role colors change as user levels up (visible in every message)
- Buttons for quick quiz answers and SRS ratings
- Threads for focused study sessions
- Progress bars via unicode block characters in embeds: `[██████████──────]` 60%
- Streak calendar via emoji grid (like GitHub contribution graph)

**Critical insight:** Points and badges alone produce short-term engagement that fades. What sustains learning is **meaning, agency, and curiosity**. Gamification should reward genuine skill demonstration, not just time spent.

### Conversational Tutoring Patterns

**Socratic method (Khanmigo's approach):**
1. Never give direct answers first
2. Ask "What have you tried?" / "Where are you stuck?"
3. Break complex problems into manageable steps
4. Challenge assumptions with follow-up questions
5. Guide toward understanding through questioning
6. Only explain after learner has attempted

**Duolingo Max's approach:**
- AI roleplay personas for conversation practice
- Context-sensitive corrections (gentle, not punitive)
- Adapts to learner's level automatically
- Lower anxiety than human conversation partners

**Key finding:** In studies, AI tutor students showed greater learning gains in less time (49 min vs 60 min lecture), with 83% rating AI explanations as good as or better than human instructors.

**Design rules for chat-based tutoring:**
- Short sessions with reflection checkpoints
- Always require learner participation (never just lecture)
- Balance challenge and support (ZPD)
- Structured beats unstructured

### Interleaved Practice

Instead of drilling one topic at a time, mix different topics/skills in a single session:

- **Mixed review sessions** — alternate between categories
- **Surprise quiz** — drop a random question during casual chat (if configured)
- **Cross-module interleaving** — if studying both Japanese and programming, mix them

Research shows interleaving produces better long-term retention than blocking by topic, even though it feels harder in the moment.

## Notes

- The FSRS algorithm is already content-agnostic — it schedules any front/back card
- Per-user multi-deck already works — just need module-aware deck naming
- The plugin system's `userTools` whitelist means we control which tools non-owners can use
- Session persistence (currently TODO in language-learning) should be built into tutor from the start

---

# Phase 2: Structured Lesson System

> Status: Specced
> Date: 2026-04-01

## Problem

The Phase 1 tutor has SRS flashcards, quizzes, and conversational tutoring — but these all assume the student has **already learned** the material. For absolute beginners starting from zero, there's no guided introduction of new concepts. Research consistently shows that beginners need explicit, structured instruction before SRS or conversation can be effective.

**The gap:** Learn → Practice → Retain. Phase 1 has Practice (quizzes) and Retain (SRS). Phase 2 adds **Learn** (structured lessons).

## Design Decisions

Finalized through discussion:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Input method | Buttons + typing mix | Button-heavy for early/kana lessons, gradually introduce typing for production |
| Entry point | Slash commands (`/lesson`, `/progress`) | Bypasses Claude roundtrip → instant feedback (<100ms). Chat stays for freeform tutoring |
| Lesson length | 3-5 min (~12 exercises) | Short sessions, high frequency. Users can chain multiple. Duolingo validated this. |
| Multi-user | Yes, works in servers + DMs | Progress keyed by user ID (already how tutor works) |
| Progression | Strictly linear | Must complete Unit N before Unit N+1. Simpler to build, correct for Japanese. |
| Feedback style | Simple for kana, explanatory for grammar | "Incorrect → answer" for drills, "Incorrect → here's WHY" for grammar |
| Content authoring | Static → template → LLM (layered) | Kana = static JSON, vocab = template from word lists, grammar = Claude-generated + cached |

## Design Principles

1. **Structured progression** — each lesson teaches ONE concept with explanation + examples + exercises
2. **Mastery-gated** — must score 80%+ to unlock the next lesson (prevents overwhelm)
3. **Exercise variety** — multiple choice, fill-in-blank, production, error correction (not just flashcards)
4. **Prereq-aware** — lessons have dependencies; can't learn て-form before ます-form
5. **SRS integration** — lesson completion feeds new items into the SRS queue automatically
6. **Discord-native** — slash commands for lessons, buttons for exercises, embeds for content
7. **Snappy** — lesson flow handled entirely by Discord interactions, no Claude in the loop

## Architecture

```
plugins/tutor/
├── core/
│   ├── srs.ts                      # (existing) FSRS engine
│   ├── session.ts                  # (extend) Add lesson progress tracking
│   ├── types.ts                    # (extend) Lesson types
│   ├── lesson-engine.ts            # NEW — lesson runner: present, score, progress
│   └── exercise-engine.ts          # NEW — exercise presentation + scoring
├── tools/
│   ├── lesson-tools.ts             # NEW — start_lesson, continue_lesson, lesson_status
│   └── ...                         # (existing tools unchanged)
└── modules/
    └── japanese/
        ├── lessons/                # NEW — lesson data files
        │   ├── index.ts            # Lesson registry + ordering
        │   ├── unit-1-hiragana/    # Lessons 1.1-1.10
        │   ├── unit-2-katakana/    # Lessons 2.1-2.10
        │   ├── unit-3-phrases/     # Lessons 3.1-3.6
        │   ├── unit-4-grammar/     # Lessons 4.1-4.8
        │   └── ...
        └── data/
            ├── n5-vocab.json       # (existing)
            ├── grammar-points.json # NEW — structured grammar DB
            └── sentences.json      # NEW — graded example sentences
```

## Japanese Curriculum (N5)

The lesson sequence follows the standard Japanese pedagogy order that every serious program agrees on:

### Unit 1: Hiragana (10 lessons)
| Lesson | Content | Exercises |
|--------|---------|-----------|
| 1.1 | Vowels: あいうえお | Recognition (show kana → pick romaji), production (romaji → type kana) |
| 1.2 | K-row: かきくけこ | Same + mixed review with vowels |
| 1.3 | S-row: さしすせそ | Same + reading kana words |
| 1.4 | T-row: たちつてと | Same |
| 1.5 | N-row: なにぬねの | Same |
| 1.6 | H-row: はひふへほ | Same |
| 1.7 | M-row: まみむめも | Same |
| 1.8 | Y/R/W-row: やゆよ, らりるれろ, わをん | Same |
| 1.9 | Dakuten + combo: が, ざ, きゃ, しゅ, etc. | Same |
| 1.10 | Review + reading practice | Read full kana words and simple sentences |

### Unit 2: Katakana (6 lessons)
Same structure as hiragana but compressed (students already understand the system).

### Unit 3: First Words & Phrases (6 lessons)
| Lesson | Content |
|--------|---------|
| 3.1 | Greetings: こんにちは, おはよう, ありがとう, すみません |
| 3.2 | Self-introduction: [name]です, はじめまして |
| 3.3 | Numbers 1-100 |
| 3.4 | Basic nouns (food, animals, objects) |
| 3.5 | Demonstratives: これ, それ, あれ, この, その, あの |
| 3.6 | Yes/No: はい/いいえ, そうです/ちがいます |

### Unit 4: Basic Grammar (8 lessons)
| Lesson | Content |
|--------|---------|
| 4.1 | XはYです (X is Y) — topic marker は + copula です |
| 4.2 | Questions with か, question words (なに, どこ, だれ, いつ) |
| 4.3 | Negation: じゃないです, ではありません |
| 4.4 | Particles: を (object), に (direction/time), で (location/means) |
| 4.5 | Verb ます-form (polite present/future) |
| 4.6 | Verb ました (polite past), ませんでした (polite past negative) |
| 4.7 | Adjectives: い-adj and な-adj + conjugation |
| 4.8 | Existence: いる/ある + に particle |

### Unit 5: Building Sentences (6 lessons)
| Lesson | Content |
|--------|---------|
| 5.1 | Connecting sentences: そして, でも, から |
| 5.2 | て-form introduction |
| 5.3 | て-form applications: ている, てください |
| 5.4 | Wanting: ～たい, ～がほしい |
| 5.5 | Comparison: より, のほうが, いちばん |
| 5.6 | Review + guided conversation using all learned material |

## Lesson Data Format

Each lesson is a JSON file:

```json
{
  "id": "1.1",
  "unit": "hiragana",
  "title": "Vowels: あいうえお",
  "prerequisites": [],
  "introduction": {
    "text": "Japanese has 5 vowel sounds that are the foundation of the entire writing system.",
    "items": [
      {
        "char": "あ",
        "reading": "a",
        "mnemonic": "Looks like someone going 'Ahhh!' at the dentist",
        "audio_hint": "Like 'a' in 'father'"
      }
    ]
  },
  "exercises": [
    {
      "type": "recognition",
      "prompt": "What sound does あ make?",
      "answer": "a",
      "distractors": ["i", "u", "e", "o"]
    },
    {
      "type": "production",
      "prompt": "Type the hiragana for 'a'",
      "answer": "あ",
      "accept": ["あ", "a"]
    },
    {
      "type": "cloze",
      "prompt": "___いうえお",
      "answer": "あ",
      "hint": "The first vowel"
    }
  ],
  "srs_items": [
    { "front": "あ", "back": "a (ah)" },
    { "front": "い", "back": "i (ee)" }
  ],
  "skills_taught": ["hiragana_a", "hiragana_i", "hiragana_u", "hiragana_e", "hiragana_o"]
}
```

## Exercise Types

| Type | Discord Implementation | Scoring |
|------|----------------------|---------|
| **Recognition** (see JP → pick meaning) | Embed + 4-5 buttons | Correct/incorrect |
| **Production** (see meaning → type JP) | Embed prompt, user types answer | Fuzzy match (romaji accepted for kana) |
| **Cloze** (fill the blank) | Embed with `___`, user types or picks from buttons | Exact match |
| **Sentence build** (arrange words) | Numbered word list, user types order | Order match |
| **Error correction** (find the mistake) | Embed with wrong sentence, user identifies error | Match target |
| **Multiple choice** (general) | Embed + buttons | Correct/incorrect |
| **Matching** (term → definition) | Sequential: show term, pick from buttons | Per-pair scoring |

### Discord Button Constraints

- Max 5 buttons per row, max 5 rows = 25 buttons total
- Buttons support custom emoji (useful for kana)
- Button interactions must be responded to within 3 seconds (use deferReply for slow ops)
- Buttons expire after 15 minutes by default (set custom timeout per exercise)

## Lesson Engine

### Core Flow

```
User: "start a lesson" or "continue learning"
  → lesson-engine checks user progress
  → finds next available lesson (prereqs met, not completed)
  → presents lesson introduction (embed)
  → runs exercises sequentially (embed + buttons/text input)
  → scores each exercise, tracks correct/total
  → if score >= 80%: mark complete, unlock next, add SRS items
  → if score < 80%: encourage retry, highlight weak areas
  → show summary embed with score + what was learned
```

### State Machine

```
IDLE → INTRO → EXERCISE_1 → EXERCISE_2 → ... → SUMMARY → IDLE
                    ↓                                ↑
                 (timeout)  ────────────────────────→┘
```

- Lesson state persisted in SQLite (survives bot restart)
- Timeout after 10 min inactivity → save progress, can resume later
- Each exercise waits for user response (button click or text message)

### New MCP Tools

| Tool | Description |
|------|-------------|
| `start_lesson` | Start the next available lesson (or specific lesson by ID) |
| `continue_lesson` | Resume an in-progress lesson |
| `lesson_status` | Show current progress: units, lessons, completion %, next available |
| `lesson_review` | Re-do a completed lesson for extra practice |

### New Slash Commands

| Command | Description |
|---------|-------------|
| `/lesson` | Start or continue a lesson (button-driven, no Claude roundtrip) |
| `/progress` | Show learning progress embed (ephemeral) |

### Progress Visualization (`/progress`)

```
📚 Japanese — N5 Course

Unit 1: Hiragana  [██████████████████] 100%  ✓
Unit 2: Katakana  [████████──────────]  40%
Unit 3: Phrases   [🔒 locked]
Unit 4: Grammar   [🔒 locked]
Unit 5: Sentences [🔒 locked]

🔥 Streak: 5 days | 📖 12/36 lessons | 📝 47/718 words learned
Next lesson: 2.5 — Y/R/W-row (やゆよ, らりるれろ, わをん)
```

Progress bars use unicode blocks: `█` for complete, `─` for remaining. Ephemeral embed so it doesn't clutter chat.

### Feedback Examples

**Kana drill (simple):**
> ❌ That's **u** — the correct answer is **a** (あ)

**Grammar exercise (explanatory):**
> ❌ Close! You used **が** but this sentence needs **は**.
> は marks the **topic** (what we're talking about). が marks the **subject** (who does the action).
> わたし**は**学生です = "As for me, I am a student"

## Database Schema

```sql
-- Lesson progress per user
CREATE TABLE lesson_progress (
  user_id TEXT NOT NULL,
  module TEXT NOT NULL,       -- "japanese"
  lesson_id TEXT NOT NULL,    -- "1.1"
  status TEXT DEFAULT 'locked', -- locked/available/in_progress/completed
  score REAL,                 -- 0.0-1.0 (best attempt)
  attempts INTEGER DEFAULT 0,
  current_exercise INTEGER,   -- index into exercises array (for resume)
  exercise_results TEXT,      -- JSON array of per-exercise results
  started_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (user_id, module, lesson_id)
);

-- Skills/knowledge tracking per user
CREATE TABLE user_skills (
  user_id TEXT NOT NULL,
  module TEXT NOT NULL,
  skill TEXT NOT NULL,         -- "hiragana_a", "particle_wa", "verb_masu"
  level INTEGER DEFAULT 0,    -- 0-5 mastery level
  last_practiced TEXT,
  PRIMARY KEY (user_id, module, skill)
);
```

## Data Sources

### Already Have
| Data | Source | Status |
|------|--------|--------|
| N5 vocabulary (718 cards) | Bundled JSON | ✅ In use |
| Kana conversion | wanakana npm | ✅ In use |
| Furigana generation | kuroshiro + kuromoji | ✅ In use |
| Dictionary | Jisho API | ✅ In use |

### Need to Add
| Data | Source | License | Purpose |
|------|--------|---------|---------|
| Grammar points | Hanabira.org JSON | MIT/CC | Structured grammar DB with JLPT levels |
| Kanji data | kanji-data npm | MIT | 13k+ kanji with readings, JLPT level, strokes |
| Example sentences | tatoeba-json | CC BY 2.0 | Graded sentence corpus |
| Stroke order SVGs | KanjiVG | CC BY-SA 3.0 | Visual kana/kanji teaching |
| Offline dictionary | jmdict-simplified | CC BY-SA 4.0 | Remove Jisho API dependency |

### Exercise Content Generation

**Hybrid approach:**
1. **Static exercises** for kana lessons (finite, deterministic — recognition/production of specific characters)
2. **Template + data** for vocab/grammar exercises (pick random word from JLPT list, generate cloze/MC from it)
3. **Claude-generated** for complex exercises (sentence building, error correction, contextual dialogues) — generated at runtime, cached in SQLite for reuse

## TutorModule Interface Extensions

```typescript
interface TutorModule {
  // ... existing interface ...

  // Phase 2 additions
  getLessons?(): LessonInfo[];           // Available lessons with prereqs
  getLesson?(id: string): Lesson;       // Full lesson data
  getCurriculum?(): Unit[];             // Unit structure for progress display
  scoreExercise?(exercise: Exercise, answer: string): ExerciseResult;
}

interface Lesson {
  id: string;
  unit: string;
  title: string;
  prerequisites: string[];              // lesson IDs
  introduction: LessonIntro;
  exercises: Exercise[];
  srsItems?: SRSItem[];                 // Auto-add to SRS on completion
  skillsTaught: string[];
}

interface Exercise {
  type: "recognition" | "production" | "cloze" | "sentence_build" |
        "error_correction" | "multiple_choice" | "matching";
  prompt: string;
  answer: string;
  distractors?: string[];               // For MC/recognition
  accept?: string[];                    // Alternative accepted answers
  hint?: string;
  explanation?: string;                 // Shown after answering
}

interface ExerciseResult {
  correct: boolean;
  feedback: string;                     // "Correct!" or explanation
  score: number;                        // 0.0-1.0
}
```

## Implementation Priority

### Phase 2a: Core Lesson Engine (MVP)
1. Lesson data format + loader
2. Lesson engine (present intro → run exercises → score → progress)
3. `lesson_progress` + `user_skills` SQLite tables
4. `start_lesson` / `continue_lesson` / `lesson_status` tools
5. Hiragana lessons (Unit 1) — static exercises, no LLM generation needed
6. `/lesson` and `/progress` slash commands with button interactions

### Phase 2b: Full Japanese N5 Curriculum
7. Katakana lessons (Unit 2)
8. Phrases + vocabulary lessons (Unit 3) — template-based exercises
9. Grammar lessons (Units 4-5) — Claude-generated exercises with caching
10. Grammar points data from Hanabira.org
11. Graded example sentences from Tatoeba

### Phase 2c: Polish & Engagement
12. Progress visualization (embeds with progress bars, unit map)
13. Streak tracking + daily lesson reminders (leverage existing reminder system)
14. Kanji data integration (kanji-data npm)
15. Stroke order images for kana/kanji lessons
16. Lesson review/redo functionality

## What Stays the Same

- SRS engine (FSRS) — unchanged, lessons feed items into it
- Conversational tutoring — still available, now constrained to learned material
- Quizzes — still available for ad-hoc practice
- Dictionary — unchanged
- Kana converter — unchanged
- Module system — lessons are a new capability modules can opt into

## Success Metrics

- A user starting from zero can complete Unit 1 (hiragana) and read basic kana words
- Lesson completion feeds SRS → user sees those items in reviews
- 80% mastery gate prevents progression without understanding
- Exercise variety keeps engagement higher than flashcard-only
- Discord buttons make exercises feel interactive, not like homework
