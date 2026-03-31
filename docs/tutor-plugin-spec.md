# Tutor Plugin — Generalized Teaching Harness

> Status: Research & Design
> Date: 2026-03-31

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

1. Extract SRS engine from `language-learning/srs.ts` → `tutor/core/srs.ts` (no changes needed)
2. Create TutorModule interface
3. Wrap existing Japanese code as a TutorModule
4. Build the tutor plugin shell (module discovery, tool routing)
5. Migrate language-learning tools to tutor tools
6. Add new modules incrementally

## Open Questions

- [ ] Should the language-learning plugin be replaced entirely, or should tutor be a new plugin that supersedes it?
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
