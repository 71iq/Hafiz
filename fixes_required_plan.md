# Fixes Required Plan

Read them batch by batch, commit between batches, and either clear or compress context.

## Batch 1: Quick UI Fixes

Read CLAUDE.md.

Fix these 5 UI issues:

1. **Flashcard grading buttons contrast (light mode):** The Again/Hard/Good/Easy buttons have white text on light-colored backgrounds (beige page + pastel button colors). Fix by using darker text colors on each button in light mode, or use solid saturated backgrounds with white text. Make sure the contrast ratio meets WCAG AA (4.5:1 minimum). Test in both light and dark mode.

2. **Progress page daily reminder text size:** The daily reminder component text is too small. Increase the font size to at least 16px for the body text and 18px+ for any heading/time text. Make it feel prominent, not buried.

3. **Home page deck labels — show surah names:** Each deck card currently only shows surah numbers. Change to show surah names (Arabic) alongside numbers. For multi-surah decks, display ranges where possible:
   - Single surah: "سورة البقرة (2)"
   - Contiguous range: "سورة البقرة - سورة النساء (2-4)"
   - Non-contiguous: "سورة البقرة، سورة النساء، سورة المائدة (2, 4, 5)"
     Query surah names from the surahs table using the surah numbers stored in the deck metadata.

4. **Sign up/login — Enter key should submit:** In both login.tsx and signup.tsx, pressing Enter while focused on the last input field (password) should trigger form submission. Add `returnKeyType="done"` and `onSubmitEditing` handlers that call `handleSubmit()`. For multi-field forms, Enter on non-last fields should advance focus to the next field using refs.

5. **Empty top bar:** There appears to be an unnecessary empty top bar/header taking up vertical space. Identify which screen(s) have this (likely the tab layout or specific tab screens). If it's a Stack.Screen header, set `headerShown: false`. If it's safe area padding that's too aggressive, reduce it. Don't remove actual navigation headers that have content (like the Mushaf header with view toggle).

Run the app and verify all 5 fixes in both light and dark mode.

## Batch 2: Flashcard Behavior (Daily Limit + Shuffle)

Read CLAUDE.md.

Two flashcard behavior changes:

1. **Daily review limit:** When a user adds surahs they've already memorized (e.g., all of Juz Amma), they could have 500+ cards due on day one. Add a daily review limit:
   - Add a `daily_review_limit` setting to user_settings (default: 50)
   - Add a UI control in Settings under Flashcard Preferences: "Daily review limit" with a number input or stepper (range: 10-200, step 10)
   - When starting a review session, query study_cards WHERE due <= now, but LIMIT to the daily_review_limit value
   - Prioritize: overdue cards first (oldest due date), then new cards
   - On the Study Dashboard, show "X due (Y today's limit)" so the user understands they won't see all due cards
   - The remaining due cards carry over to the next session/day naturally (FSRS handles this)
   - Add i18n strings for the new setting label and dashboard text (en + ar)

2. **Shuffle card order:** Currently cards appear in surah/ayah order, which makes it too easy to predict the next card. Shuffle the cards array after querying from SQLite:
   - In the session initialization (where due cards are fetched), apply a Fisher-Yates shuffle to the cards array before starting the session
   - This should happen AFTER the daily limit is applied (so we shuffle the limited set, not the full due set)
   - The shuffle should be different each session (use Math.random, no seed needed)

Test: Create a deck with a large surah (Al-Baqarah). Verify only 50 cards appear per session. Verify card order is randomized (not sequential by ayah number).

## Batch 3: Progress Page Features

Read CLAUDE.md.

Implement the two "Coming Soon" sections on the Progress page:

1. **Memorization Activity (heatmap calendar):**
   - Build a GitHub-style contribution heatmap showing daily review activity
   - Query study_log grouped by date (reviewed_at): COUNT reviews per day
   - Display the last 3 months (90 days) as a grid of small squares
   - Color intensity based on review count: 0 = empty/gray, 1-10 = light teal, 11-25 = medium teal, 26+ = dark teal
   - Show day-of-week labels on the left (Mon, Wed, Fri or Arabic equivalents)
   - Show month labels on top
   - Tapping a day shows a tooltip: "X reviews on [date]"
   - Below the heatmap, show summary stats: "X active days in last 90 days" and "X total reviews"

2. **Surah Progress:**
   - Show a scrollable list of all 114 surahs with per-surah memorization progress
   - For each surah, query study_cards WHERE card_id starts with "surah_number:" to get: total cards, cards in Review state (memorized), cards in Learning/New state
   - Display as: surah name (Arabic + English), progress bar (memorized/total), fraction text "45/286"
   - Only show surahs that have at least 1 card (user has added them to a deck)
   - Sort by surah number
   - Tapping a surah could navigate to that surah in the Mushaf (use deep link pattern)
   - Color the progress bar: teal fill for memorized percentage

Both sections should use real data from SQLite, not mock data. Add i18n strings (en + ar) for all new labels. Use the existing design patterns (warm colors, teal accents, consistent spacing).

## Batch 4: Auth Improvements

Read CLAUDE.md.

Three auth-related changes:

1. **Require login for Progress and Leaderboard:**
   - On the Progress tab and Leaderboard tab, if the user is not logged in, show a full-screen auth gate instead of the normal content
   - Auth gate UI: Lucide Lock icon, title "Sign in to view your progress" / "Sign in to view leaderboard", subtitle explaining why (progress syncs across devices / leaderboard is a community feature), and two buttons: "Sign In" → /auth/login, "Create Account" → /auth/signup
   - Use `useAuthStore` to check auth state. The check should be reactive (updates when user logs in/out)
   - Progress page currently shows local data without auth — gate it entirely behind login
   - Leaderboard already fetches from Supabase but may show errors when not logged in — replace with clean auth gate
   - Add i18n strings for the auth gate (en + ar)

2. **Third-party login (Google, Apple, Facebook):**
   - Add OAuth login buttons to both login.tsx and signup.tsx
   - Display as a row of branded buttons below the email/password form, separated by "or" divider
   - Google: use `supabase.auth.signInWithOAuth({ provider: 'google' })` with redirect
   - Apple: use `supabase.auth.signInWithOAuth({ provider: 'apple' })` — Apple required for iOS App Store
   - Facebook: use `supabase.auth.signInWithOAuth({ provider: 'facebook' })`
   - On web, these open a popup/redirect. On native, use `expo-auth-session` or `expo-web-browser` for the OAuth flow
   - After OAuth callback, create a profile row if it doesn't exist (same as email signup)
   - Style: Apple button black, Google button white with border, Facebook button blue. Use brand icons (or Lucide fallbacks)
   - NOTE: The actual OAuth providers need to be configured in the Supabase dashboard separately. Add a comment in the code noting this.

3. **Fix RLS error on signup:**
   - The error "new row violates row-level security policy for table profiles" happens because the INSERT to profiles after signup is blocked by RLS.
   - Fix: the profiles INSERT should happen via a Supabase database trigger or function, not from the client. Create a Supabase SQL migration:

```sql
     CREATE OR REPLACE FUNCTION public.handle_new_user()
     RETURNS trigger AS $$
     BEGIN
       INSERT INTO public.profiles (id, username, display_name)
       VALUES (NEW.id, NEW.raw_user_meta_data->>'username', NEW.raw_user_meta_data->>'display_name');
       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql SECURITY DEFINER;

     CREATE OR REPLACE TRIGGER on_auth_user_created
       AFTER INSERT ON auth.users
       FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

- Pass username and display_name as metadata during signup:

```typescript
supabase.auth.signUp({
  email,
  password,
  options: { data: { username, display_name } },
});
```

- Remove the client-side profiles INSERT from the signup flow
- Also add an RLS policy allowing users to INSERT their own profile as a fallback:

```sql
     CREATE POLICY "Users can insert own profile" ON profiles
       FOR INSERT WITH CHECK (auth.uid() = id);
```

Test: Sign up with a new email account — should succeed without RLS error. Try Google login on web. Verify Progress and Leaderboard show auth gate when logged out, real content when logged in.

## Batch 5: Performance — CRITICAL (Build OOM + Slow Loading)

CONTEXT: The web build currently crashes with out-of-memory errors unless run with NODE_OPTIONS=--max-old-space-size=8192. This is because Metro/webpack is trying to inline massive JSON files into the JS bundle at build time. This is the highest-priority fix — a build that OOMs is a broken build.

Read CLAUDE.md.

CRITICAL PERFORMANCE ISSUE: The web build crashes with out-of-memory errors. The root cause is that large JSON datasets are loaded via static `require()` calls, which forces the bundler to parse and inline them into the JavaScript bundle. zilal.json alone is ~17MB, plus wbw.json, masaq-aggregated.json, 114 tafseer files, and 20 translation files. The total bundled JSON is likely 50-80MB, which is far too much for Metro to handle and far too much to send to the browser.

The fix has two parts: (A) stop bundling data files, and (B) lazy-load non-critical code.

### Part A: Move JSON datasets out of the JS bundle

This is the critical fix. ALL large JSON files must be moved from `require()` (bundled into JS) to runtime `fetch()` (loaded from static assets).

1. **Move data files to the public/static directory:**
   - For Expo web, files in the `public/` folder are served as static assets and can be fetched at runtime
   - Move these files to `public/data/`:
     - `zilal.json` (~17MB)
     - `wbw/wbw.json` (~5MB)
     - `masaq/masaq-aggregated.json` (~5MB)
     - `tafseer/*.json` (114 files, ~2MB total)
     - `translations/*.json` (20 files, ~10MB total)
     - `quran-data.json` (~3MB)
     - `tajweed.json` (~2MB)
     - `layout/page-words.json` (~3MB)
     - `layout/page-lines.json` (~0.5MB)
   - Keep QCF2 font files where they are (they're loaded by expo-font/FontFace, not require())

2. **Replace all `require()` calls with `fetch()` in init.ts:**
   - Instead of: `const data = require('../../assets/data/zilal.json')`
   - Use: `const resp = await fetch('/data/zilal.json'); const data = await resp.json();`
   - For native (iOS/Android), use `expo-asset` + `expo-file-system`:

```typescript
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";

async function loadJsonAsset(path: string) {
  if (Platform.OS === "web") {
    const resp = await fetch(`/data/${path}`);
    return resp.json();
  }
  // On native, assets are bundled differently
  const asset = Asset.fromModule(require(`../../assets/data/${path}`));
  await asset.downloadAsync();
  const text = await FileSystem.readAsStringAsync(asset.localUri!);
  return JSON.parse(text);
}
```

- IMPORTANT: On native, `require()` in `Asset.fromModule` must use static strings (Metro restriction). Create a mapping object with all static requires, but these only execute on native — not on web. The web path uses `fetch()` exclusively.
- Alternative simpler approach for native: keep `require()` for native builds only (they handle large assets better than web), and use `fetch()` only for web:

```typescript
async function loadData(filename: string, requireFn?: () => any) {
  if (Platform.OS === "web") {
    return (await fetch(`/data/${filename}`)).json();
  }
  return requireFn?.() ?? null;
}
```

3. **Translation require map (`lib/translations/translation-requires.ts`):**
   - This file has 20 static `require()` calls. On web, replace with `fetch('/data/translations/${code}.json')`
   - On native, keep the existing require map

4. **After moving files, delete them from `assets/data/`** (web only — native still needs them in assets). Or better: use a build script that copies them to `public/data/` for web builds.

5. **Add a `scripts/prepare-web-data.sh`:**

```bash
   #!/bin/bash
   # Copy data files to public/ for web static serving
   mkdir -p public/data/tafseer public/data/translations
   cp assets/data/*.json public/data/
   cp assets/data/tafseer/*.json public/data/tafseer/
   cp assets/data/translations/*.json public/data/translations/
   cp assets/data/wbw/wbw.json public/data/wbw.json
   cp assets/data/masaq/masaq-aggregated.json public/data/masaq.json
   cp assets/data/layout/*.json public/data/
```

Add to package.json: `"prebuild:web": "bash scripts/prepare-web-data.sh"`

### Part B: Lazy-load non-critical screens and libraries

6. **Lazy load heavy screens:**
   - Use `React.lazy()` + `Suspense` for:
     - Flashcard session (`app/flashcards/session.tsx`)
     - Leaderboard tab
     - Auth screens (login, signup)
     - Settings screen
     - Onboarding screen
   - Home and Mushaf load eagerly

7. **Defer Supabase client:**
   - Wrap Supabase init in a lazy module loaded only when auth/sync/reflections are accessed
   - App should boot and show Mushaf without loading Supabase

8. **Loading screen improvements:**
   - First-launch data import now fetches from network (web) or assets (native) — show a proper progress bar
   - Keep expo-splash-screen visible until SQLite is initialized and home screen data is ready
   - The import progress should show which dataset is loading: "Loading tafseer... (3/8)"

### Verification

After all changes:

1. Run `npx expo export --platform web` WITHOUT `--max-old-space-size` — it should complete without OOM
2. Check the JS bundle size in `dist/` — should be under 5MB (was likely 50MB+)
3. Open the web app — first load should show the loading screen while datasets are fetched
4. After first load (data in SQLite), subsequent loads should be near-instant
5. All features still work: Mushaf, flashcards, tafseer, search, etc.

Report: the old bundle size, the new bundle size, and the build time.
