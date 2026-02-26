# Hafiz - Software Requirements Specification (SRS)

## 1. Project Overview
**App Name**: Hafiz
**Target Platforms**: iOS, Android, and Web (Unified codebase via Expo).
**Core Philosophy**: **Offline-First**. The app must function 100% without an internet connection for study and reading. Syncing features (Community, Leaderboard, Backup) happen when online.
**Purpose**: A Quran retention tool combining a standard Mushaf with an advanced, multi-faceted Flashcard system using Spaced Repetition (SRS).

**Agent Instructions (For Claude Code):**
You are an expert Full-Stack Mobile Developer. Your goal is to build a robust, production-grade application. You must strictly follow the **Implementation Phases**. Do not hallucinate external API requirements; use the defined architecture.

## 2. Tech Stack & Architecture

### 2.1. Frontend
*   **Framework**: Expo (React Native).
*   **Navigation**: Expo Router (handling Deep Links for sharing).
*   **Local Database (Crucial)**: `expo-sqlite` (or `op-sqlite`). The entire Quran text, metadata, and user study logs live here for offline access.
*   **State Management**: `Zustand` (Global UI state) + `TanStack Query` (Async state/Syncing logic).
*   **Styling**: `NativeWind` (Tailwind CSS).

### 2.2. Backend & Sync
*   **Backend**: Supabase (PostgreSQL, Auth, Edge Functions if needed).
*   **Sync Strategy**:
    *   **Read**: App reads Quran data from local SQLite.
    *   **Write**: User flashcard progress is written to local SQLite immediately.
    *   **Sync**: A background process pushes local changes to Supabase and pulls community updates when online.

### 2.3. Data Source
*   **Quran Data**: Open-source JSON/SQL datasets (e.g., Tanzil/Quran.com data) converted to a local SQLite database file `.db` included in the app bundle.

## 3. Core Features & User Flows

### 3.1. The "Offline-First" Mushaf (Reading Mode)
*   **Display**: Standard Uthmani Script (Hafs).
*   **Customization**:
    *   **Font Size Control**: Slider to increase/decrease text size.
    *   **Theme**: Dark/Light mode support.
    *   **Hide Ayahs**: A toggle to mask Ayah text for ad-hoc self-testing.
*   **Text Selection & Context Menu**:
    *   Long-press on an Ayah (or range) opens a menu:
        1.  **Ask Community**: Opens the "New Post" flow.
        2.  **Copy**: Copies the text to clipboard in this specific format:
            > "{Ayah Text}"
            > [Surah {Name} : Ayah {Number}]
            > {Link: hafiz://open?surah=x&ayah=y}
*   **Deep Linking**: If a user clicks the generated link, the app opens directly to that specific Ayah in the Mushaf.

### 3.2. Advanced Multi-Sided Flashcards
*   **Deck Generation**: User selects tags: `Surah`, `Juz`, `Hizb`.
*   **Uniqueness Logic**: The "Front" of the card is a specific verse.
    *   *Constraint*: If the verse text is not unique (e.g., "فبأي آلاء ربكما تكذبان"), the system must include the preceding or succeeding verse (or Surah name context) until the prompt is unique.
*   **Multi-Sided Flow (The Carousel)**:
    *   The user enables specific "Test Modes" in settings (e.g., "Next Verse", "Meanings", "Tafseer").
    *   **Card Step 1**: Show Unique Prefix/Ayah. User taps "Reveal".
    *   **Card Step 2**: Show Answer for Test A (e.g., The Next Verse). User taps "Next Question".
    *   **Card Step 3**: Show Answer for Test B (e.g., Word Meanings).
    *   **Final Step**: User rates the *entire* card difficulty (Again, Hard, Good, Easy) to feed the SRS Algorithm.
*   **Algorithm**: SM-2 or FSRS logic. Calculated locally, stored locally, synced to cloud later.

### 3.3. Smart Search
*   **Standard Search**: Text matching.
*   **Root Word Search (جذر الكلمة)**:
    *   Users enter a root (e.g., "كتب").
    *   App queries the local SQLite mapping table.
    *   Results show every derivative word and its Ayah location.

### 3.4. Community (Online Only)
*   **Constraint**: Text only. No links/images allowed.
*   **Creation**: Can *only* start from highlighting text in Mushaf/Flashcards.
*   **Structure**: Posts are linked to specific `Ayah IDs`.
*   **Interaction**: Comments, Likes.

### 3.5. Leaderboard (Online Only)
*   Requires Auth.
*   Ranks users based on "Cards Reviewed" or "Streaks" synced from their local database.

---

## 4. Data Models (SQLite + Supabase Schema)

**Claude Code:** You must ensure the schema in SQLite (Local) matches the schema in Supabase (Cloud) for the syncable tables.

### 4.1. Static Data (Read-Only, Pre-populated in SQLite)
*   `quran_text`: (surah, ayah, text_uthmani, text_clean).
*   `word_roots`: (word_id, ayah_key, root_arabic).
*   `tafseer`: (ayah_key, tafseer_text).
*   `translations`: (ayah_key, text_en).

### 4.2. Syncable User Data (Read/Write)
*   `profiles`: (id [uuid], username, score).
*   `study_log`: (id, ayah_key, last_review_date, next_review_date, interval, ease_factor).
*   `posts`: (id, user_id, ayah_key, content, likes).

---

## 5. Step-by-Step Implementation Plan

**Instructions for Claude Code: Stop after every phase to allow for testing.**

### Phase 1: Foundation & Offline Database Setup
1.  Initialize Expo (Typescript, NativeWind).
2.  Setup `expo-sqlite`.
3.  **Crucial Task**: Create a script to import a `quran.json` file and convert it into the local SQLite `.db` file on app launch (or pre-bundle it).
4.  Verify you can query a random Ayah from the local DB.

### Phase 2: The Mushaf (Reading Experience)
1.  Build the `Mushaf` screen with a virtualized list (FlashList or FlatList) for performance.
2.  Implement Font Size Slider and Dark Mode.
3.  Implement the "Hide Ayahs" (blur/mask) feature.
4.  Implement Text Selection, Context Menu, and the "Copy with Deep Link" logic.
5.  Configure Expo Router to handle incoming `hafiz://` links.

### Phase 3: The Flashcard Engine (Multi-Sided)
1.  Implement the Deck Generator (Query SQLite by Surah/Juz).
2.  Implement the **Uniqueness Algorithm** (Check if text is unique; if not, prepend previous ayah).
3.  Build the **Multi-Sided UI**:
    *   State machine: `Front` -> `Side A` -> `Side B` -> `Grading`.
4.  Implement the SRS Math (SM-2) to update the `study_log` table in SQLite.

### Phase 4: Root Search
1.  Import Root Word data into SQLite.
2.  Build the Search UI with tabs: "Text" and "Root".
3.  Display results grouped by the specific derivative word.

### Phase 5: Authentication & Sync (Supabase)
1.  Setup Supabase project.
2.  Implement Login/Signup.
3.  **Sync Logic**: Create a hook that checks for internet connection. If connected:
    *   Push local `study_log` changes to Supabase.
    *   Update user score.

### Phase 6: Community & Leaderboard
1.  Build the `Community` feed (fetching from Supabase).
2.  Connect the "Ask Community" context menu action to the Post creation screen.
3.  Build the `Leaderboard` UI.
