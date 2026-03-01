# Hafiz — Software Requirements Specification (SRS)

## Agent Instructions

You are an expert Full-Stack Mobile Developer building a production-grade Quran retention app. Follow the Implementation Phases strictly — complete each phase fully and stop for testing before proceeding. Do not hallucinate APIs, endpoints, or data structures. Use only the datasets, URLs, and libraries specified in this document. When in doubt, refer back to this spec.

---

## 1. Project Overview

| Field | Value |
|-------|-------|
| **App Name** | Hafiz |
| **Platforms** | iOS, Android, Web (unified codebase via Expo) |
| **Core Philosophy** | **Offline-First**. 100% functional without internet for reading and study. Online features (Reflections, Leaderboard, Backup) sync when connected. |
| **Purpose** | A Quran retention tool combining a full-featured Mushaf reader (inspired by quran.com + wahy.net) with an advanced Flashcard system using the FSRS spaced repetition algorithm. |

### 1.1 Design Philosophy

The UI is a **hybrid of quran.com and wahy.net**. The reading experience, layout, typography, and overall aesthetic should closely match quran.com — clean, minimal, reading-focused with warm neutral tones. The word-level interaction model (tap-to-explore with linguistic data panels) is inspired by wahy.net.

**Design References** (screenshots will be in `design-references/` folder):
- quran.com — overall layout, font, color palette, verse-by-verse + reading (page) view, reflections UI
- wahy.net — word interaction popover, linguistic data panels

**Design Tokens:**
- **Font (Quran text):** UthmanicHafs (KFGQPC) — see §2.4 for download
- **Font (UI):** System default (San Francisco on iOS, Roboto on Android) for UI, plus a clean Arabic UI font (e.g., IBM Plex Arabic or Noto Sans Arabic) for non-Quran Arabic text
- **Color palette:** Warm neutrals matching quran.com — not stark white. Dark mode support required.
- **Spacing:** Generous line-height for Arabic text (minimum 2.0x). Clear visual hierarchy.
- **Components:** Rounded cards, subtle shadows, no visual clutter. Transitions should feel smooth and intentional.
- **RTL:** First-class requirement. All layouts must be RTL-aware from day one, not retrofitted.

---

## 2. Tech Stack & Architecture

### 2.1 Frontend

| Layer | Technology |
|-------|------------|
| **Framework** | Expo (React Native, TypeScript) |
| **Navigation** | Expo Router (with deep link handling for `hafiz://` scheme) |
| **Styling** | NativeWind (Tailwind CSS for React Native) |
| **State Management** | Zustand (global UI state) + TanStack Query (async state, caching, sync logic) |
| **HTTP Client** | Axios |
| **Forms** | React Hook Form + Zod (validation schemas) |
| **Icons** | Lucide React Native |
| **UI Components** | React Native equivalents of shadcn/ui patterns (use `react-native-reusables` or build a component library following shadcn conventions: composable, accessible, unstyled base + NativeWind styling) |
| **Local Database** | `expo-sqlite` (or `op-sqlite` for performance) |
| **Lists** | FlashList (virtualized, performant for 6000+ ayah lists) |
| **SRS Algorithm** | `ts-fsrs` (npm package, v5.2.3+, zero dependencies, FSRS-6) |

### 2.2 Backend & Sync

| Layer | Technology |
|-------|------------|
| **Backend** | Supabase (PostgreSQL, Auth, Edge Functions, Realtime) |
| **Auth** | Supabase Auth (email/password + OAuth providers) |
| **Sync Strategy** | Offline-first: read/write to local SQLite immediately. Background sync pushes changes to Supabase when online. Conflict resolution: last-write-wins with timestamp. |

**Sync flow:**
1. All reads come from local SQLite — never block on network.
2. All writes go to local SQLite first, then queue for sync.
3. A background hook checks connectivity. When online: push queued local changes to Supabase, pull new reflections/leaderboard data.
4. Use TanStack Query's `onlineManager` and mutation queue for sync orchestration.

### 2.3 Data Architecture

Two categories of data:

**Static (read-only, pre-bundled in app):**
- Quran text (Uthmani + clean)
- Word-by-word translations
- Morphology / إعراب / تصريف
- Tajweed annotations
- Tafseer
- Surah/Juz/Hizb/Page metadata
- Word roots

**User-generated (read/write, synced):**
- Study log (FSRS card states)
- User profile & settings
- Reflections (posts, comments, likes)
- Leaderboard scores
- Bookmarks & highlights

### 2.4 Required Assets & Datasets

**All assets must be downloaded and bundled BEFORE development begins.** Do not fetch these at runtime for core features.

#### 2.4.1 Quran Text (already have)
Your existing `quran-data.json` contains:
- `surahs` (114 rows): number, name_arabic, name_english, ayah_count, revelation_type
- `quran_text` (6,236 rows): surah, ayah, text_uthmani, text_clean
- `juz_map` (135 rows): juz, surah, ayah_start, ayah_end
- `hizb_map` (60 rows): hizb, surah_start, ayah_start, surah_end, ayah_end
- `word_roots` (50,268 rows): surah, ayah, word_pos, word_text, root, lemma

#### 2.4.2 Tafseer Al-Muyassar (التفسير الميسر)
- **Source:** `spa5k/tafsir_api` (MIT license)
- **Format:** JSON, one file per surah (114 files)
- **Download pattern:** `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/ar-tafsir-muyassar/{1-114}.json`
- **Structure:** Array of `{ ayah: number, text: string }` per file
- **Alternative (single SQLite with everything):** `Abdallah-Mekky/Quran-Database` → `https://github.com/Abdallah-Mekky/Quran-Database/raw/main/quran.zip` — contains `quran.db` with columns: sora, aya_no, aya_text, page, jozz, tafseer_moysar, tafseer_saadi, tafseer_bughiu

#### 2.4.3 Sahih International English Translation
- **Source:** AlQuran Cloud API (free, Tanzil upstream)
- **Download (full Quran, single call):** `http://api.alquran.cloud/v1/quran/en.sahih`
- **Structure:** `data.surahs[].ayahs[]` → each ayah has `numberInSurah`, `text` (English), `juz`, `page`
- **Alternative (static JSON):** `https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/quran_en.json` from `risan/quran-json` (CC-BY-SA-4.0)

#### 2.4.4 Page-to-Ayah Mapping (604 Madani Mushaf pages)
- **Source:** `rn0x/Quran-Data` (MIT license)
- **Download:** `https://raw.githubusercontent.com/rn0x/Quran-Data/version-2.0/data/pagesQuran.json`
- **Structure:** Array of `{ page, start: { surah_number, verse, name }, end: { surah_number, verse, name } }` for all 604 pages

#### 2.4.5 Arabic Font (UthmanicHafs)
- **Font:** KFGQPC HAFS Uthmanic Script (same font used by quran.com)
- **Download (TTF):** `https://verses.quran.foundation/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.ttf`
- **License:** Free to use, copy, distribute. Cannot be sold, modified, or reverse-engineered.
- **Usage:** Bundle in `assets/fonts/`, load via `expo-font`, apply to all Quran text rendering.

#### 2.4.6 Word-by-Word English Translation
- **Source:** Quranic Universal Library (QUL) at `https://qul.tarteel.ai/resources`
- **English WBW translation:** Resource ID 92, downloadable as JSON/SQLite
- **Structure:** Maps each word (surah:ayah:word_position) to its English meaning and transliteration
- **License:** Intended for app bundling per QUL's stated purpose

#### 2.4.7 Morphology & إعراب (Grammatical Analysis)
- **إعراب dataset:** MASAQ (Morphologically-Analyzed & Syntactically-Annotated Quran)
  - **Download:** Mendeley Data → `https://data.mendeley.com/datasets/9yvrzxktmr/5`
  - **Format:** SQLite, JSON, CSV, TSV available
  - **Structure:** 131,000+ entries with 20 columns: surah, verse, word_position, arabic_word, morphological_tag, syntactic_function (إعراب role), root, lemma, pattern. 72 distinct syntactic roles covering full traditional i'rab tagset.
  - **License:** CC BY 3.0

- **تصريف (morphology/conjugation):** `mustafa0x/quran-morphology` on GitHub
  - Enhanced fork of the Quranic Arabic Corpus with Arabic script (not Buckwalter), corrected roots/lemmas, and Arabic terminology dictionary
  - **Structure:** Per-word: form, POS tag, root, lemma, person, gender, number, case, mood, voice, verb form

#### 2.4.8 Tajweed Rules
- **Source:** `cpfair/quran-tajweed` on GitHub (CC BY 4.0)
- **Format:** JSON file `tajweed.hafs.uthmani-pause-sajdah.json`
- **Structure:** Per ayah, array of `{ rule, start, end }` where start/end are Unicode codepoint offsets in Tanzil Uthmani text
- **Rules covered:** ghunnah, idghaam (6 types), ikhfa (2 types), iqlab, madd (6 types), qalqalah, hamzat al-wasl, lam al-shamsiyyah, and more

#### 2.4.9 Qira'at (Variant Readings) — DEFERRED
- **Status:** No structured open-source per-word qira'at dataset exists.
- **Action:** Defer this feature to a future phase. Design the word popover UI with a placeholder slot for qira'at that can be populated later.

### 2.5 FSRS Configuration (ts-fsrs)

```typescript
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';

const scheduler = fsrs({
  request_retention: 0.95,    // Higher than default 0.9 — Quran memorization demands precision
  maximum_interval: 365,
  enable_fuzz: true,           // Add small randomness to prevent clustering
  enable_short_term: true,     // Enable learning steps for new cards
});

// Rating enum: Again (1), Hard (2), Good (3), Easy (4)
// Card states: New → Learning → Review → Relearning
```

Each card persists 10 fields in SQLite: `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review`.

---

## 3. Core Features & User Flows

### 3.1 The Mushaf (Reading Experience)

The Mushaf supports **two view modes** (togglable like quran.com):

#### 3.1.1 Reading View (Page-Based)
- Renders ayahs grouped by their Mushaf page (604 pages) using the page-to-ayah mapping dataset.
- Each page shows the surah header (decorated) if a new surah begins on that page.
- Swipe left/right to navigate pages.
- The feel should resemble a physical Mushaf.

#### 3.1.2 Verse-by-Verse View (Scroll-Based)
- Virtualized scrolling list of ayahs (use FlashList).
- Each ayah displayed as a block with its number badge.
- Below each ayah (collapsible): translation, tafseer, reflections (like quran.com).

#### 3.1.3 Common to Both Views
- **Font:** UthmanicHafs for all Quran text, rendered RTL.
- **Font Size Control:** Slider to adjust text size. Persist preference.
- **Theme:** Light / Dark mode. Follow system preference with manual override.
- **Hide Ayahs:** Toggle to blur/mask ayah text for self-testing.
- **Surah Header:** Decorative header with surah name (Arabic), English name, ayah count, revelation type. Basmala displayed for all surahs except At-Tawbah (surah 9).

### 3.2 Word-Level Interaction

This is a key differentiator, inspired by wahy.net and quran.com's word-by-word feature.

#### 3.2.1 Hover/Tap Behavior
- **On hover (web) / light tap (mobile):** Show inline tooltip below the word with its English meaning (from WBW translation dataset).
- **On click/firm tap:** Open a **Word Detail Popover/Bottom Sheet** with multiple tabs:

| Tab | Content | Data Source |
|-----|---------|-------------|
| **English Meaning** | Word-by-word English translation | QUL WBW dataset |
| **المعنى** | Arabic meaning/context | Tafseer Al-Muyassar (ayah-level) |
| **إعراب** | Full grammatical parsing (syntactic role, case, etc.) | MASAQ dataset |
| **تصريف** | Morphological analysis: root, pattern, verb form, POS, person/gender/number | mustafa0x/quran-morphology |
| **حكم تجويدي** | Tajweed rule affecting this word (if any), with rule name and description | cpfair/quran-tajweed |
| **قراءات** | *Placeholder — coming soon* | Deferred (§2.4.9) |
| **Search Results** | Other occurrences of this word/root in the Quran | Local SQLite query on word_roots table |

#### 3.2.2 Text Selection & Context Menu
Users can select text at three granularities:
- **Single word** (tap)
- **Single ayah** (tap ayah number badge)
- **Custom range** (long-press and drag across multiple words or ayahs)

On selection, show a context menu with:
1. **Copy** — Copies selected text in this format:
   ```
   "{Ayah Text}"
   [Surah {Name} : Ayah {Number}]
   hafiz://open?surah={x}&ayah={y}
   ```
2. **Share** — System share sheet with the same formatted text.
3. **Add Reflection** — Opens the "New Reflection" flow (§3.5) pre-linked to the selected ayah(s).
4. **Highlight** — Save a colored highlight on the selection (persisted locally, synced).
5. **Bookmark** — Quick bookmark the ayah.

### 3.3 Deep Linking
- Scheme: `hafiz://open?surah={x}&ayah={y}`
- Configure Expo Router to handle incoming links and navigate directly to the specified ayah in the Mushaf.

### 3.4 Smart Search

#### 3.4.1 Standard Text Search
- Full-text search across `text_clean` column (no diacritics) for more forgiving matching.
- Results show matching ayahs with the search term highlighted, grouped by surah.

#### 3.4.2 Root Word Search (جذر الكلمة) — Optional Toggle
- User enters a root (e.g., "كتب").
- Query the `word_roots` table for all entries with matching `root`.
- Results grouped by derivative word (`lemma`), showing each occurrence with its ayah and context.
- Display: root → list of lemmas → list of ayah occurrences per lemma.

### 3.5 Reflections (Community Feature — Online Only)

Replaces the previous "Community" concept. Modeled after quran.com's reflections feature.

#### 3.5.1 Display
- In **Verse-by-Verse view**, each ayah has a collapsible "Reflections" section below the translation/tafseer.
- Shows reflection count badge. Expand to see reflection cards inline.
- Each card shows: author name, timestamp, reflection text, like count, comment count.

#### 3.5.2 Constraints
- **Text only.** No links, images, or media.
- **Must be tied to specific ayah(s).** Cannot create standalone posts.
- A reflection can reference a single ayah or a contiguous range of ayahs within one surah.

#### 3.5.3 Creation
- Can **only** be initiated from the text selection context menu (§3.2.2) or from a "Write Reflection" button in the expanded reflections section.
- New Reflection form: text area + preview of the referenced ayah(s). Submit requires auth.

#### 3.5.4 Interaction
- **Like** a reflection (toggle, requires auth).
- **Comment** on a reflection (text only, requires auth).
- **Report** a reflection (moderation queue).

#### 3.5.5 Data Model (Supabase)
```sql
reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  surah INTEGER NOT NULL,
  ayah_start INTEGER NOT NULL,
  ayah_end INTEGER NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 10 AND 5000),
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

reflection_likes (
  user_id UUID REFERENCES profiles(id),
  reflection_id UUID REFERENCES reflections(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, reflection_id)
);

reflection_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reflection_id UUID REFERENCES reflections(id),
  user_id UUID REFERENCES profiles(id),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.6 Advanced Flashcards (Multi-Sided, FSRS-Powered)

#### 3.6.1 Deck Generation
User creates a deck by selecting a scope:
- **By Surah:** Select one or more surahs.
- **By Juz:** Select one or more juz (1–30).
- **By Hizb:** Select one or more hizb (1–60).
- **Custom range:** Surah X, ayah Y to surah X, ayah Z.

Each ayah in the selected scope becomes one card in the deck.

#### 3.6.2 Card Uniqueness Algorithm
**Problem:** Some ayah texts are repeated verbatim across the Quran (e.g., "فبأي آلاء ربكما تكذبان" appears 31 times in Surah Ar-Rahman).

**Solution:** The "front" (prompt) of each card must be **uniquely identifiable**:
1. Check if the ayah text is unique across the entire Quran.
2. If not unique, prepend the previous ayah's text (or append the next ayah's text) until the combined text is unique.
3. If still not unique after 2 ayahs of context, display the surah name + ayah number as additional context.
4. Always show the surah name subtly as secondary context regardless.

#### 3.6.3 Multi-Sided Card Flow (The Carousel)
The user enables specific "test modes" in Settings. Each enabled mode adds a step to the card flow.

**Available test modes (user enables/disables each):**

| Mode | Front (Prompt) | Back (Answer) |
|------|----------------|---------------|
| **Next Ayah** | Show unique prefix ayah(s) | Reveal the next ayah |
| **Previous Ayah** | Show an ayah | Reveal what came before it |
| **Translation** | Show Arabic ayah | Reveal English translation |
| **Tafseer** | Show Arabic ayah | Reveal tafseer text |
| **First Letter** | Show first letter of each word in the ayah | Reveal full ayah |
| **Surah Identification** | Show an ayah (without surah context) | Reveal which surah it's from |

**Card session flow:**
1. **Front:** Show the unique prompt for this card.
2. **Side 1:** User taps "Reveal" → shows answer for first enabled test mode. User taps "Next".
3. **Side 2:** Shows answer for second enabled test mode (if enabled). User taps "Next".
4. ...repeat for all enabled modes...
5. **Grading:** User rates the **entire card** on a 4-point scale:
   - **Again** (forgot) → Rating.Again
   - **Hard** (struggled) → Rating.Hard
   - **Good** (recalled with effort) → Rating.Good
   - **Easy** (instant recall) → Rating.Easy
6. The rating feeds into `ts-fsrs` to compute the next review date and update card state.

#### 3.6.4 Study Session UI
- Show progress bar: cards remaining in session.
- Show card state indicators: new (blue), learning (orange), review (green), relearning (red).
- Session summary at end: cards reviewed, retention rate, streak info.
- Option to end session early.

#### 3.6.5 Study Log (Local SQLite, synced to Supabase)
```sql
study_cards (
  id TEXT PRIMARY KEY,           -- Format: "surah:ayah" e.g. "2:255"
  deck_id TEXT NOT NULL,
  due TEXT NOT NULL,              -- ISO date
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,  -- 0=New, 1=Learning, 2=Review, 3=Relearning
  last_review TEXT,              -- ISO date or null
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

study_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL,       -- 1=Again, 2=Hard, 3=Good, 4=Easy
  state INTEGER NOT NULL,
  due TEXT NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  sync_status TEXT DEFAULT 'pending'  -- 'pending', 'synced'
);
```

### 3.7 Leaderboard (Online Only)

#### 3.7.1 Scoring Algorithm
The leaderboard must be **fair** — it should reward consistent study, not just volume.

**Point formula per review:**
```
points = base_points × streak_multiplier × difficulty_bonus × retention_bonus

Where:
  base_points = 10
  streak_multiplier = min(1 + (current_streak_days × 0.05), 2.0)   // Max 2x at 20-day streak
  difficulty_bonus = 1 + (card_difficulty / 10 × 0.5)                // Harder cards worth more
  retention_bonus = card_stability / 100                              // More mature cards worth more (capped)
```

**Anti-gaming measures:**
- Maximum 200 reviews per day count toward leaderboard.
- "Again" ratings give 0 points (no farming by intentionally failing).
- Points are computed locally, verified on sync by checking study_log timestamps and patterns.

#### 3.7.2 Leaderboard Tiers
- **Daily:** Top reviewers today.
- **Weekly:** Rolling 7-day totals.
- **All-time:** Cumulative score.
- **Streak:** Longest current streak.

#### 3.7.3 Data Model (Supabase)
```sql
profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  username TEXT UNIQUE NOT NULL CHECK (length(username) BETWEEN 3 AND 20),
  display_name TEXT,
  avatar_url TEXT,
  total_score INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  cards_reviewed INTEGER DEFAULT 0,
  last_review_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

daily_scores (
  user_id UUID REFERENCES profiles(id),
  date DATE NOT NULL,
  score INTEGER DEFAULT 0,
  reviews_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
```

### 3.8 Settings

- **Reading preferences:** Font size, theme (light/dark/auto), default Mushaf view mode (page/verse-by-verse), show/hide translation inline, show/hide tafseer inline.
- **Flashcard preferences:** Enabled test modes (checkboxes), daily review limit, new cards per day.
- **Notifications:** Daily review reminder (time picker).
- **Account:** Login/logout, username, sync status.
- **Data:** Export study data, clear local data.

---

## 4. Complete Data Schema

### 4.1 Local SQLite (Pre-populated + User Data)

**Pre-populated tables (read-only):**

```sql
-- From quran-data.json
surahs (number INTEGER PK, name_arabic TEXT, name_english TEXT, ayah_count INTEGER, revelation_type TEXT);
quran_text (surah INTEGER, ayah INTEGER, text_uthmani TEXT, text_clean TEXT, PRIMARY KEY (surah, ayah));
juz_map (juz INTEGER, surah INTEGER, ayah_start INTEGER, ayah_end INTEGER);
hizb_map (hizb INTEGER, surah_start INTEGER, ayah_start INTEGER, surah_end INTEGER, ayah_end INTEGER);
word_roots (surah INTEGER, ayah INTEGER, word_pos INTEGER, word_text TEXT, root TEXT, lemma TEXT);

-- From page mapping dataset
page_map (page INTEGER, surah_start INTEGER, ayah_start INTEGER, surah_end INTEGER, ayah_end INTEGER);

-- From tafseer dataset
tafseer (surah INTEGER, ayah INTEGER, text TEXT, PRIMARY KEY (surah, ayah));

-- From translation dataset
translations (surah INTEGER, ayah INTEGER, text_en TEXT, PRIMARY KEY (surah, ayah));

-- From QUL word-by-word
word_translations (surah INTEGER, ayah INTEGER, word_pos INTEGER, word_arabic TEXT, translation_en TEXT, transliteration TEXT, PRIMARY KEY (surah, ayah, word_pos));

-- From MASAQ dataset
word_irab (surah INTEGER, ayah INTEGER, word_pos INTEGER, arabic_word TEXT, morphological_tag TEXT, syntactic_function TEXT, root TEXT, lemma TEXT, pattern TEXT, PRIMARY KEY (surah, ayah, word_pos));

-- From mustafa0x/quran-morphology
word_morphology (surah INTEGER, ayah INTEGER, word_pos INTEGER, form TEXT, pos_tag TEXT, root TEXT, lemma TEXT, person TEXT, gender TEXT, number TEXT, case_field TEXT, mood TEXT, voice TEXT, verb_form TEXT, PRIMARY KEY (surah, ayah, word_pos));

-- From cpfair/quran-tajweed
tajweed_rules (surah INTEGER, ayah INTEGER, rule TEXT, start_offset INTEGER, end_offset INTEGER);
```

**User data tables (read/write, synced):**

```sql
study_cards (...);     -- See §3.6.5
study_log (...);       -- See §3.6.5
bookmarks (surah INTEGER, ayah INTEGER, created_at TEXT, PRIMARY KEY (surah, ayah));
highlights (id INTEGER PK, surah INTEGER, ayah INTEGER, word_start INTEGER, word_end INTEGER, color TEXT, created_at TEXT);
user_settings (key TEXT PK, value TEXT);
sync_queue (id INTEGER PK AUTOINCREMENT, table_name TEXT, operation TEXT, data TEXT, created_at TEXT);
```

### 4.2 Supabase (Cloud)

Mirrors the syncable tables above, plus:
- `profiles` (§3.7.3)
- `daily_scores` (§3.7.3)
- `reflections` (§3.5.5)
- `reflection_likes` (§3.5.5)
- `reflection_comments` (§3.5.5)

Use Supabase Row Level Security (RLS) policies:
- Users can only write their own study_log, bookmarks, highlights.
- Reflections are publicly readable, writable only by the author.
- Profiles are publicly readable (for leaderboard), writable only by owner.

---

## 5. Step-by-Step Implementation Plan

**CRITICAL: Complete each phase fully. Stop for testing. Do not skip ahead.**

### Phase 1: Project Foundation & Data Pipeline
**Goal:** App boots, loads all static data into SQLite, can query any ayah.

1. Initialize Expo project with TypeScript and NativeWind.
2. Configure `expo-sqlite`.
3. Bundle the UthmanicHafs font via `expo-font`.
4. Write a data import script that runs on first app launch:
   - Import `quran-data.json` into SQLite tables (surahs, quran_text, juz_map, hizb_map, word_roots).
   - Import tafseer JSON files into `tafseer` table.
   - Import translation JSON into `translations` table.
   - Import page mapping JSON into `page_map` table.
   - Import WBW translation data into `word_translations` table.
   - Import MASAQ data into `word_irab` table.
   - Import morphology data into `word_morphology` table.
   - Import tajweed JSON into `tajweed_rules` table.
5. Show a loading/splash screen during first-launch import.
6. **Verify:** Query a random ayah with all its associated data (translation, tafseer, WBW, morphology, i'rab, tajweed) from local SQLite.

### Phase 2a: Mushaf — Core Reading (Verse-by-Verse)
**Goal:** Scrollable verse-by-verse reading with proper typography.

1. Create tab navigation: Mushaf, Search, Flashcards, Leaderboard, Settings.
2. Build the verse-by-verse Mushaf screen with FlashList.
3. Render each ayah with UthmanicHafs font, ayah number badge, RTL layout.
4. Add surah headers (decorative) with name, bismillah handling.
5. Implement font size slider (persist in user_settings).
6. Implement dark/light/auto theme toggle.
7. **Verify:** Scroll through the entire Quran smoothly with proper Arabic rendering.

### Phase 2b: Mushaf — Page-Based View
**Goal:** Page-based reading mimicking the physical Mushaf.

1. Build the page-based view using `page_map` data.
2. Group ayahs by page, render as a single page with proper layout.
3. Implement swipe/pagination to navigate between pages.
4. Add a toggle in the header to switch between page view and verse-by-verse view.
5. **Verify:** Navigate all 604 pages with correct ayah grouping.

### Phase 2c: Mushaf — Inline Content
**Goal:** Translation, tafseer, and "hide ayahs" mode.

1. In verse-by-verse view: add collapsible translation below each ayah.
2. Add collapsible tafseer below translation.
3. Implement "Hide Ayahs" toggle that blurs/masks ayah text.
4. Persist collapse/expand preferences.
5. **Verify:** Toggle translation and tafseer per-ayah. Hide mode works.

### Phase 3a: Word-Level Interaction — Hover & Popover
**Goal:** Tap a word to see its meaning; deep-tap for full linguistic panel.

1. Make each word in an ayah individually tappable (wrap in pressable components).
2. On tap: show inline tooltip with English WBW meaning.
3. On long-press or second tap: open a bottom sheet with tabs.
4. Implement tabs: English Meaning, المعنى, إعراب, تصريف, حكم تجويدي, قراءات (placeholder), Search Results.
5. For "Search Results" tab: query word_roots for all occurrences of this word's root.
6. **Verify:** Tap any word → see English meaning. Long-press → see full panel with all tabs populated.

### Phase 3b: Text Selection & Context Menu
**Goal:** Select words/ayahs, copy, share, bookmark, highlight.

1. Implement text selection: single word, single ayah, custom range.
2. Build context menu: Copy, Share, Add Reflection, Highlight, Bookmark.
3. Copy format: `"{text}" [Surah {name} : Ayah {number}] hafiz://open?surah=X&ayah=Y`
4. Implement bookmarks table and UI (bookmarks list in a separate screen or drawer).
5. Implement highlights with color picker (4 preset colors).
6. **Verify:** Select text → copy → paste shows correct format. Bookmarks and highlights persist.

### Phase 3c: Deep Linking
**Goal:** `hafiz://` links open the app to the correct ayah.

1. Configure Expo Router for `hafiz://` scheme.
2. Handle `hafiz://open?surah=X&ayah=Y` → navigate to Mushaf at that ayah.
3. **Verify:** Click a `hafiz://` link from outside the app → app opens to correct location.

### Phase 4: Smart Search
**Goal:** Text search and root-word search.

1. Build Search screen with a search bar and two mode tabs: "Text" and "Root (جذر)".
2. **Text search:** Query `quran_text.text_clean` with LIKE. Display results grouped by surah, with matching text highlighted.
3. **Root search:** Query `word_roots` by `root` column. Group results by `lemma`, then show ayah occurrences per lemma with the derivative word highlighted.
4. Tapping a search result navigates to that ayah in the Mushaf.
5. **Verify:** Search "رحم" in both modes. Text search finds ayahs containing the string. Root search finds all derivatives of the root.

### Phase 5: Flashcard Engine
**Goal:** Full flashcard system with FSRS algorithm.

1. Install `ts-fsrs`.
2. Build deck creation screen: select scope (surah/juz/hizb/custom range).
3. Implement the uniqueness algorithm (§3.6.2).
4. Build the multi-sided card UI:
   - State machine: Front → Side 1 → Side 2 → ... → Grading.
   - Animate transitions between sides.
5. Implement all test modes (§3.6.3): Next Ayah, Previous Ayah, Translation, Tafseer, First Letter, Surah Identification.
6. Implement settings UI for enabling/disabling test modes.
7. On grading: call `scheduler.next(card, now, rating)` and persist updated card state to `study_cards` table. Log the review to `study_log` table.
8. Build session summary screen.
9. Build a "Study" dashboard showing: due cards today, new cards available, current streak.
10. **Verify:** Create a deck from Surah Al-Fatiha. Review all 7 cards. Check that next review dates are computed correctly and stored in SQLite.

### Phase 6: Authentication & Sync
**Goal:** Users can sign up, log in, and data syncs to cloud.

1. Set up Supabase project with the schema from §4.2.
2. Implement auth screens: Login, Signup (React Hook Form + Zod validation).
3. Build the sync engine:
   - On app start (if online): pull latest data from Supabase.
   - After each local write to a syncable table: add entry to `sync_queue`.
   - Background task: when online, process `sync_queue` → push to Supabase → mark as synced.
   - Use TanStack Query's mutation queue for retries.
4. Handle conflict resolution: last-write-wins using `updated_at` timestamps.
5. **Verify:** Create an account. Do some flashcard reviews offline. Go online → data appears in Supabase. Log in on a different device → data synced.

### Phase 7: Reflections
**Goal:** Community reflections tied to ayahs.

1. Create Supabase tables for reflections, likes, comments (§3.5.5).
2. In verse-by-verse view: add "Reflections ({count})" collapsible section per ayah.
3. Fetch reflections from Supabase for visible ayahs (paginated, cached with TanStack Query).
4. Build reflection card component: author, text, timestamp, like button, comment count.
5. Build "Write Reflection" bottom sheet (triggered from context menu or inline button).
6. Implement like toggle and comment thread.
7. **Verify:** Write a reflection on Ayah 2:255. See it appear under that ayah. Like it. Comment on it.

### Phase 8: Leaderboard
**Goal:** Fair, engaging leaderboard.

1. Implement scoring algorithm (§3.7.1) — compute points after each review.
2. After sync: push `daily_scores` to Supabase.
3. Build Leaderboard screen with 4 tabs: Daily, Weekly, All-time, Streak.
4. Fetch and display ranked users (profile pic, name, score, rank).
5. Highlight current user's position.
6. **Verify:** Review cards → score increases. Check leaderboard shows correct rankings.

### Phase 9: Polish & Production Readiness
**Goal:** App feels production-grade.

1. Add loading skeletons for all async content.
2. Implement pull-to-refresh on reflections and leaderboard.
3. Add haptic feedback on card grading buttons.
4. Implement daily review reminder notification.
5. Add onboarding flow (first launch): welcome → select surahs you've memorized → create first deck.
6. Performance audit: ensure Mushaf scrolling is 60fps, search is < 100ms, database queries are indexed.
7. Add proper error boundaries and offline indicators.
8. App icon and splash screen.
9. **Verify:** Full end-to-end user journey: sign up → read Quran → tap words → create deck → review cards → write reflection → check leaderboard.

---

## 6. Project Structure

```
hafiz/
├── app/                          # Expo Router pages
│   ├── (tabs)/
│   │   ├── mushaf/
│   │   │   ├── index.tsx         # Mushaf screen (verse-by-verse default)
│   │   │   └── [page].tsx        # Page-based view
│   │   ├── search.tsx
│   │   ├── flashcards/
│   │   │   ├── index.tsx         # Study dashboard
│   │   │   ├── session.tsx       # Active review session
│   │   │   └── create-deck.tsx
│   │   ├── leaderboard.tsx
│   │   └── settings.tsx
│   ├── auth/
│   │   ├── login.tsx
│   │   └── signup.tsx
│   └── _layout.tsx
├── components/
│   ├── ui/                       # shadcn-style base components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── bottom-sheet.tsx
│   │   ├── input.tsx
│   │   ├── badge.tsx
│   │   └── ...
│   ├── mushaf/
│   │   ├── AyahBlock.tsx         # Single ayah with word-level interaction
│   │   ├── WordToken.tsx         # Individual tappable word
│   │   ├── WordDetailSheet.tsx   # Bottom sheet with linguistic tabs
│   │   ├── SurahHeader.tsx
│   │   ├── PageView.tsx
│   │   ├── VerseByVerseView.tsx
│   │   ├── SelectionContextMenu.tsx
│   │   └── HideAyahOverlay.tsx
│   ├── flashcards/
│   │   ├── FlashCard.tsx
│   │   ├── CardFront.tsx
│   │   ├── CardSide.tsx
│   │   ├── GradingButtons.tsx
│   │   ├── DeckSelector.tsx
│   │   └── SessionSummary.tsx
│   ├── reflections/
│   │   ├── ReflectionCard.tsx
│   │   ├── ReflectionList.tsx
│   │   ├── WriteReflection.tsx
│   │   └── CommentThread.tsx
│   └── leaderboard/
│       ├── LeaderboardRow.tsx
│       └── LeaderboardTabs.tsx
├── lib/
│   ├── database/
│   │   ├── schema.ts             # SQLite table definitions
│   │   ├── init.ts               # First-launch data import
│   │   ├── queries.ts            # Typed query functions
│   │   └── sync.ts               # Sync engine
│   ├── fsrs/
│   │   ├── scheduler.ts          # ts-fsrs configuration
│   │   ├── scoring.ts            # Leaderboard point calculation
│   │   └── uniqueness.ts         # Card uniqueness algorithm
│   ├── supabase.ts               # Supabase client init
│   └── utils.ts
├── stores/
│   ├── useSettingsStore.ts       # Zustand: theme, font size, view mode
│   ├── useStudyStore.ts          # Zustand: active session state
│   └── useAuthStore.ts           # Zustand: auth state
├── hooks/
│   ├── useQuranData.ts           # TanStack Query: fetch from local SQLite
│   ├── useReflections.ts         # TanStack Query: reflections CRUD
│   ├── useLeaderboard.ts         # TanStack Query: leaderboard data
│   └── useSync.ts                # Background sync hook
├── assets/
│   ├── fonts/
│   │   └── UthmanicHafs1Ver18.ttf
│   └── data/                     # Bundled datasets (JSON/SQLite)
│       ├── quran-data.json
│       ├── tafseer/
│       ├── translation.json
│       ├── page-map.json
│       ├── wbw/
│       ├── masaq/
│       ├── morphology/
│       └── tajweed.json
├── design-references/            # Screenshot references for UI
├── schemas/                      # Zod validation schemas
│   ├── auth.ts
│   ├── reflection.ts
│   └── settings.ts
└── constants/
    ├── colors.ts
    ├── fonts.ts
    └── config.ts
```

---

## 7. Key Technical Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SRS Algorithm | FSRS-6 via ts-fsrs | 88% more accurate than SM-2. Zero deps, runs in Hermes. |
| Font | UthmanicHafs V18 | Same font as quran.com. Single file, full Unicode support. |
| Local DB | expo-sqlite | Expo-native, no native module headaches. |
| Sync strategy | Offline-first, last-write-wins | Quran study is personal; merge conflicts are rare. |
| Page mapping | Pre-bundled JSON | Offline-first requirement. No runtime API dependency. |
| Qira'at | Deferred | No open-source structured dataset exists. Placeholder in UI. |
| Community model | Reflections (quran.com style) | Inline under verses, not separate page. Better UX for contextual discussion. |
| Word data | QUL + MASAQ + mustafa0x | Three datasets cover all linguistic layers. All offline-bundleable. |
