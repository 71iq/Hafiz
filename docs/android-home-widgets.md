# Hafiz Android home-screen widgets

A glance at the home screen should answer two questions. Does today count yet? How much of today is left? The flame beside the number answers the first. The sky behind Zayt answers the second. The words and tap destination still work with Zayt hidden.

## Concept

Zayt is a drop of olive oil, the fuel of a lamp. The streak is the flame beside the number. The background is the sky over an olive grove, and it follows the person's local day. As today runs out the sky darkens, and Zayt's own light becomes the main light in the scene. Urgency comes from the sky and from how much Zayt's light matters in it. Zayt's face never shows it. When today counts, the scene turns gold, by night too, and the widget needs no words.

The flame is the only fire in the Zayt system. The owner asked for it on 2026-11-21. It never appears on or around Zayt, and Zayt never holds anything. The other character rules in the Zayt spec still apply: no sad, worried or sleeping face, no pose that resembles worship, and closed eyes only in a short blink.

## What we learned from Duolingo

The signed Android app `com.duolingo` 6.106.5 (2503) declares a 2×1 and a 4×2 streak widget. Static REA inspection found a local rules engine. Each refresh works out a state from the streak, today's practice, a freeze and the local hour, in bands of 0 to 16, 16 to 20, 20 to 22 and 22 to 24. It then picks one of 85 small or 74 medium art presets at random, avoiding presets already shown that day, and holds the pick for 2 hours early in the day and 30 minutes late at night. The count is white until the day's practice and orange after it. Backgrounds are baked gradients that darken towards midnight, and some late scenes loop a 2.1 second eye animation. Its urgency comes from Duo's distress: crying, melting, burning and angry eyes. [Duolingo's account of designing the widget](https://blog.duolingo.com/widget-feature) · [Android app](https://play.google.com/store/apps/details?id=com.duolingo)

Hafiz keeps the time bands, the darkening sky, the colour change of the count and the slow idle blink. It refuses the distress. Its bands follow the person's evening start, and its widget knows the local wird, review queue, make-up cutoff and pause, so it changes exactly at those moments instead of at the next hourly refresh. All art comes from the Hafiz Zayt studio.

## Picker, placement and resizing

Android offers **Hafiz streak**, a 2×2 tile, and **Hafiz wird** at 4×2. Both use the same data and resize down to a single row. Each layout has an ideal size. From Android 12 the launcher picks the closest ideal size that fits the widget. Earlier versions apply the same rule to the size in the widget options, so one size gets one layout everywhere. Every minimum leaves room for a three-digit count beside the flame.

| Ideal size, dp    | Layout                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 320×170           | Roomy wide: flame and count, one line, the week row and the plan or grace note at the start; Zayt up to 150 dp wide at the end. |
| 250×170           | Wide: the same without the note, with Zayt up to 112 dp wide.                                                                   |
| 130×130           | Tile: flame and count centred at the top, one line below, Zayt filling the rest with the feet just cut by the edge.             |
| 110×100           | Small tile: the tile without the line beside a count, so Zayt keeps its size.                                                   |
| 250×64 and 170×64 | Short: flame, count and line at the start; a tall Zayt at the end looks up from the bottom edge.                                |
| 210×40            | Strip: one row with the line beside the count, and Zayt looking up.                                                             |
| 100×40            | Tiny: the flame with the count, or the line when there is no count. No Zayt, so neither is cut.                                 |

With **Show Zayt** on, the background is the scene. With it off, each layout shows a plain card in the app's theme, the System theme following the launcher's day or night colours. An expired or unreadable timeline gets the neutral text layout.

The launcher picker shows a sample done day. **Settings → General → Home screen widget** uses the current local state for the native pin dialog where the launcher supports it. The one-time, post-session offer keeps its place behind rest, encouragement and reminder prompts.

## Count, flame and line

The count is the streak length, 0 included. On a scene it turns the flame's colour once today counts. The flame is lit once today counts, an outline with an ember while the streak waits for today, and an empty outline at 0. Paused days show the outline. A lit flame grows through seven stages, at 7, 14, 30, 50, 100 and 365 days, gaining a glow, a second tongue, a white-hot core and glints of light.

The line is short. A done day has none, since the lit flame and the gold scene already say it. With Show numbers off the count is hidden, so a done day says "Done today".

The 4×2 widget from 170 dp tall adds a week row: the last seven days with today last, each under its weekday letter. A recited day is a small lit flame, a day kept by grace, an excuse or a pause is a soft dot, today's open day is the ember, and any other day is an empty ring. Nothing marks a day as missed.

## State, sky and Zayt

Each entry uses the same habit projection and review-left rules as Home. **Wird** means the page review for a page plan and the ayah review otherwise. An onboarding or review session already in progress keeps its place.

While today is open the sky follows these bands. Dusk starts at Hafiz's reminder boundary, 20 minutes after Isha, capped at 22:45, or 21:00 without prayer times. A late evening start skips dusk.

| Band        | From          | Scene             | Zayt                         | Line                  |
| ----------- | ------------- | ----------------- | ---------------------------- | --------------------- |
| Morning     | 00:00         | Pale blue to gold | Standing, eyes open          | Today's wird awaits   |
| Midday      | 12:00         | Clear blue        | Waving                       | Keep it going         |
| Golden hour | 16:00         | Amber             | Warm smile                   | Time for today's wird |
| Dusk        | Evening start | Rose and violet   | Inner light risen            | Still time today      |
| Night       | 22:00         | Indigo, stars     | Arms open, with its own halo | Before midnight       |
| Last hour   | 23:00         | Nearly black      | Glowing brightest            | Last hour of today    |

| State                    | Scene                     | Zayt             | Line                  | Tap                                    |
| ------------------------ | ------------------------- | ---------------- | --------------------- | -------------------------------------- |
| Begin                    | Dawn, or night after dusk | Wave, or glowing | Start your streak     | Home                                   |
| Fresh start              | Dawn, or night after dusk | Wave, or glowing | Begin a new streak    | Wird                                   |
| Open day                 | By band                   | By band          | By band               | Wird                                   |
| Make-up available        | Dawn                      | Wave             | Make up by the cutoff | Wird                                   |
| Earning back, open       | By band                   | By band          | Earning back: n of 3  | Wird                                   |
| Earning back, today done | Sunrise, or gold night    | Arms open        | Today counts: n of 3  | Home                                   |
| Done                     | Gold, or gold night       | Shimmer          | None                  | Home                                   |
| Safe, review left        | Gold, or gold night       | Warm smile       | Review left today     | Wird                                   |
| Milestone                | Gold burst                | Milestone still  | None, or review left  | Wird if review remains, otherwise Home |
| Kept                     | Calm                      | Seated           | Streak kept for today | Home                                   |
| Paused                   | Calm                      | Seated           | Paused until the date | Home                                   |

The widget never displays Quran text, an excuse category, a sad face or a warning that implies the character is waiting for the person. These changes send no notification.

## Motion and event ownership

Standing stills blink slowly about every 4 and 6 seconds, two blinks with unequal gaps. The seated and celebrating stills never close their eyes. On the night and last-hour skies, the waiting flame's ember glows and settles every two seconds. Each is a frame list on an indeterminate ProgressBar inside the widget's RemoteViews, so the launcher runs it and Hafiz never wakes to animate.

A completed, locally committed review can carry a wird progress event: the minimum met, a day made up or a streak earned back. The widget lifecycle remembers it in memory for that local day and the first background transition consumes it. At backgrounding, Hafiz sends a fresh timeline with a one-time celebration request. Native plays the clip that the entry now showing calls for: the A07 turn on a milestone or the A06 hop on a done day. Other states keep the blink. Each clip ends on the entry's own still. Twelve seconds after publication, one follow-up refresh reads the latest state and returns to the blink. The launcher decodes every frame before a clip starts, which took about 7 seconds on a software-rendered emulator, so the hold leaves a slow launcher time to play it. Clip frames are packed at 400 by 480 pixels to keep that decoding and its memory small; the last drawing is the full-size still. Actual display timing depends on the launcher.

A new install, pin, resize, startup, clock change, sync or account restore shows the current still and blink. None of those creates a locally earned event, and a second trip to the launcher that day does not repeat one. Changing accounts or restoring local data discards a pending event. With system animations off, every widget is still. There is no sound or haptic feedback.

## Offline use, privacy and accessibility

Hafiz calculates up to seven local days from on-device data and publishes a bounded timeline into Android's app-private, no-backup storage. The widget chooses the current entry from it while the app is closed, and wakes at each sky band, midnight, the make-up cutoff, the evening start and later review coming due. Android may defer scheduled work. A timeline that would pass 64 entries ends early, and the widget asks for Hafiz to be opened at that point. After expiry, unreadable data or a time-zone mismatch, the widget says to open Hafiz and omits personal figures. A version 1 timeline stored before an update still renders in the new look, with a midday sky for open days, until Hafiz publishes again.

**Show numbers** controls the streak length, day counts and plan figures in the text and TalkBack label. The flame's stage still shows. A useful cutoff time or pause date can still appear. **Show Zayt** controls the scene and Zayt in every personal render and its pin preview. The launcher's generic catalog artwork is a design sample. English and Arabic use their own strings, digits and reading direction. Arabic moves the text to the right and Zayt to the left, and Zayt still waves with the same hand.

The entire card is one tap target and one TalkBack description, which keeps the full sentences: the streak, the state and its detail, and the note. The scene, Zayt, the frames and the flame are decorative.

## Art and acceptance

The art comes from the Zayt studio's widget export on the `feat/zayt-widget-art` branch: twelve scenes in a square and a wide crop, twelve stills, eight blink frames and the done and milestone clips. To reproduce the Android resources, run `node scripts/render-widget-art.mjs /path/to/studio/zayt/widget/out` from the app checkout. It copies the files and writes the frame lists and their ProgressBar layouts. The flame icons are vector drawables in `android/app/src/main/res/drawable`. `tests/unit/widget-resources.test.ts` checks that every scene, pose and flame JavaScript can send has its resources and is accepted by the Kotlin parser.

Acceptance covers both picker entries, all six layouts, every state and band, both directions, fixed and System themes with Zayt off, numbers off, reduced motion, expired data and tap routing. On a native widget host, watch the blink, a done hop and a milestone turn end on their stills, then repeat with reduced motion. Read the Arabic line and check the start edge at narrow widths. Check that the text, destination and accessible label remain useful with no art.

This specification covers Android home-screen widgets. An iOS WidgetKit implementation and a lock-screen surface would each need a separate product decision.
