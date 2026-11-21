# Hafiz Android home-screen widgets

A glance at the home screen should answer two questions. How is today's wird going? Where can I pick it up? Zayt makes the answer recognizable on both widget sizes. The words and tap destination also work with the character hidden.

## What we learned from Duolingo

The signed Android app `com.duolingo` 6.106.5 (2503) declares a 2×1 and a 4×2 home-screen streak widget. REA package and method inspection found separate small and medium scene lists, 16 named widget states, 85 small art presets, 74 medium art presets and 26 native animation layouts. Presets include still illustrations. The medium layouts can also carry calendar marks. One concrete small-widget path selects a coffee illustration with a native animated-vector eyelid effect that repeats every 2.1 seconds. These are capabilities in the downloaded app. Live rollout and device playback were outside the static inspection. [Duolingo's account of designing the widget](https://blog.duolingo.com/widget-feature) · [Android app](https://play.google.com/store/apps/details?id=com.duolingo)

Hafiz borrows two choices from that design. Give the small widget a character people can recognize, and give different moments different silhouettes. Hafiz already knows the person's local wird, review queue, evening boundary and pause settings. Those determine the scene. All art comes from the Hafiz Zayt studio.

## Picker, placement and resizing

Android offers **Hafiz streak** at 2×1 and **Hafiz wird** at 4×2. Both use the same data and respond to the space the launcher actually gives them. A larger grid cell on one launcher can select a different layout than the same nominal cell on another. Android 12 and later receive the size alternatives together. Earlier versions use the dimensions in the widget options.

| Available space, dp | Visible content |
| --- | --- |
| 110×40, tiny | Zayt and the streak count. When there is no count, show the status headline. |
| 200×40, strip | Zayt and count beside the headline, which can wrap to two lines. |
| 110×96, compact | Zayt beside the count and its caption, with the headline on the next row. |
| 250×110, short wird | Larger Zayt next to the status marker, count and headline. |
| 250×190, expanded wird | Larger Zayt, marker, count, headline, detail and one relevant plan or grace note. |

When multiple layouts fit, the order is expanded wird, short wird, compact, strip, tiny. In the three smaller layouts Zayt takes the marker's place. Turning off **Show Zayt** restores the marker there and gives the larger layouts their art space back. An expired or unavailable timeline always gets the neutral text-only layout.

The launcher picker shows a sample. **Settings → General → Home screen widget** uses the current local state for the native pin dialog where the launcher supports it. The existing one-time, post-session offer keeps its place behind rest, encouragement and reminder prompts. Placement and dismissal are device choices.

## State and action

Each row uses the same habit projection and review-left rules as Home. In the table, **Wird** means the page review for a page plan and the ayah review otherwise. If onboarding or a review session is already in progress, the existing navigation guard preserves it.

| State | Message | Zayt | Tap |
| --- | --- | --- | --- |
| Begin | Invitation to begin the first wird | Welcome wave | Home |
| Fresh start | Begin a new streak | Welcome wave | Wird |
| Open day | Today's wird is open | Standing, eyes open | Wird |
| Open evening | There is still time today | Steady inner light | Wird |
| Make-up available | A make-up is available until the local cutoff | Welcome wave | Wird |
| Earning back, open | Today's step in earning back a streak | Warm smile | Wird |
| Earning back, today done | Today counts toward earning it back | Open arms after the rebound | Home |
| Done | Today's minimum is complete | Daily shimmer | Home |
| Safe, review left | Streak is safe and review is still due | Warm smile | Wird |
| Milestone | Today's completion reached a streak milestone | Landing cheer and sparks | Wird if review remains, otherwise Home |
| Kept | Streak kept for today | Seated | Home |
| Paused | Pause and its end date | Seated | Home |

The evening illustration starts at Hafiz's reminder boundary, 20 minutes after Isha, capped at 22:45, or 21:00 when prayer times are unavailable. The make-up deadline is the existing local cutoff. These state changes do not send a notification. The widget never displays Quran text, an excuse category, a disappointed face or a warning that implies the character is waiting for the person.

## Motion and event ownership

A completed, locally committed review can carry an actual wird progress event. If its streak length is a milestone, the widget lifecycle remembers it in memory for that local day. The first background transition consumes it. The ordinary seven-day timeline still publishes as soon as progress changes. At backgrounding, Hafiz sends a fresh timeline plus a one-time native motion request. The renderer plays it only if the selected entry still says milestone, Zayt is visible, a widget is placed and system animator duration scale is above zero.

The clip is a 1.6-second, silent, in-place turn and landing. All sizes share the same 17 samples. A host-native progress drawable plays the one-shot frame sequence; Hafiz never wakes the app for individual frames. The last drawing is the milestone still. Five seconds after publication, one follow-up refresh reads the latest state and replaces the temporary drawable with static art. The extra time lets a busy launcher finish drawing the landing. Actual display timing depends on the launcher. The widget may already be settled by the time someone looks at it.

A new install, pin, resize, startup, clock change, sync or account restore can display the current milestone still. None of those actions creates a locally earned event. A second trip to the launcher that day does not repeat an already consumed event. Changing accounts or restoring local data discards a pending event. Ordinary completions, late evenings, paused days and grace days use stills. There is no sound, haptic feedback or continuous animation.

## Offline use, privacy and accessibility

Hafiz calculates up to seven local days from on-device data and publishes a bounded timeline into Android's app-private, no-backup storage. Both widgets choose the current entry from that timeline while the app is closed. They refresh around midnight, the make-up cutoff, the evening boundary and later review becoming due. Android may defer scheduled work. After expiry, unreadable data or a time-zone mismatch, the widget says to open Hafiz and omits personal figures.

**Show numbers** controls the streak length, day counts and plan figures in the copy and TalkBack label. A useful cutoff time or pause date can still appear. **Show Zayt** controls every personal widget render and its dynamic pin preview. The launcher's generic catalog artwork is a design sample. English and Arabic use their own strings, digits and reading direction. The artwork stays upright with the same waving hand. Fixed white, beige, dark and AMOLED themes follow the app. System mode uses the launcher's day or night palette.

The entire card is one tap target and one TalkBack description. The character, frame sequence and status marker are decorative. Turning off system animations displays the milestone still. No layout needs a new permission, account, network request or remote widget service.

## Art and acceptance

The wave, shimmer, rebound and milestone come from A04, A06, A08 and A07 in the reviewed Zayt studio revision `278afa4b`. The existing standing, warm, glow and seated stills supply the other poses. The widget packages the drawings it needs as Android resources. To reproduce the new resources, run `node scripts/render-widget-art.mjs /path/to/studio/zayt/animations` from the app checkout. [Zayt studio revision](https://github.com/71iq/Hafiz/commit/278afa4b38f036980358c656a9090526f4fc6aaa)

Acceptance covers both picker entries, all five sizes, the twelve states, both directions, fixed and system themes, Zayt off, numbers off, reduced motion, expired data and tap routing. On a native widget host, observe a real sequence of different frames on an eligible milestone, then the final still. Repeat with an ordinary refresh, an app return and reduced motion. Read the Arabic headline and check the start edge at narrow widths. Check that the text, destination and accessible label remain useful with no art.

This specification covers Android home-screen widgets. An iOS WidgetKit implementation, a lock-screen surface, a weekly calendar and additional animation families would each need a separate product decision.
