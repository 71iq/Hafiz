# Hafiz Android home-screen widgets

A glance at the home screen should answer two questions. Does today count yet? How long until the streak is lost? The flame beside the number answers the first. Zayt, the sky and one short line answer the second, louder as the deadline nears. The words and tap destination still work with Zayt hidden.

## Concept

The widget is minimal and expressive: the flame and count, one short line, and Zayt, the largest thing on it. Its job is to keep the person consistent, so it pushes harder as the streak's deadline nears, the way Duolingo's widget does. The owner decided this on 2026-11-21 and lifted the Zayt rules that kept Zayt's face calm for it.

Zayt is a drop of olive oil, the fuel of a lamp. The streak is the flame beside the number. The background is the sky over an olive grove. While today is open, the time left before the streak is at stake sets the urgency: the sky darkens towards midnight, the waiting flame's ember grows, the line names what is at stake, and Zayt goes from happy to eager, impatient, worried, anxious and panicked. When today counts, the scene turns gold, by night too, Zayt celebrates, and the widget needs no words.

The flame is the only fire in the Zayt system. It never appears on or around Zayt. Zayt never holds anything and never takes a pose that resembles worship. After a lost streak Zayt is lonely but hopeful and invites a fresh start; the widget never counts the days away or blames the person.

## What we learned from Duolingo

The signed Android app `com.duolingo` 6.106.5 (2503) declares a 2×1 and a 4×2 streak widget. Static REA inspection found a local rules engine. Each refresh works out a state from the streak, today's practice, a freeze and the local hour, in bands of 0 to 16, 16 to 20, 20 to 22 and 22 to 24. It then picks one of 85 small or 74 medium art presets at random, avoiding presets already shown that day, and holds the pick for 2 hours early in the day and 30 minutes late at night. The count is white until the day's practice and orange after it. Backgrounds are baked gradients that darken towards midnight, and some late scenes loop a 2.1 second eye animation. Its urgency comes from Duo's distress: crying, melting, burning and angry eyes. [Duolingo's account of designing the widget](https://blog.duolingo.com/widget-feature) · [Android app](https://play.google.com/store/apps/details?id=com.duolingo)

Hafiz takes the escalation: the darkening sky, a character whose state follows the time left, loss-framed lines, an alert flame, motion late in the day, daily variety and the relief of the done state. It leaves out the cruelty after a loss: the "N days without you" counter, the crack across the tile and the dead mascot. Its levels count down to the real deadline, including the make-up window, and it knows the local wird, review queue and pause, so it changes exactly at those moments instead of at the next hourly refresh. All art comes from the Hafiz Zayt studio. The full study is in the widget research notes outside the repository.

## Picker, placement and resizing

Android offers **Hafiz streak**, a 2×2 tile, and **Hafiz wird** at 4×2. Both use the same data. The streak tile resizes down to a single row. The wird widget keeps enough height for the week. Each layout has an ideal size. From Android 12 the launcher picks the closest ideal size that fits the widget. Earlier versions apply the same rule to the size in the widget options, so one size gets one layout everywhere. Every minimum leaves room for a three-digit count beside the flame.

| Ideal size, dp      | Layout                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 250×210 and 320×210 | Tall wide: the week spans the bottom. Above it, the count and line sit beside a larger Zayt.                                                          |
| 320×170             | Roomy wide: flame and count, one line and the week row at the start; Zayt up to 165 dp wide at the end.                                               |
| 250×170             | Wide: the same with Zayt up to 112 dp wide.                                                                                                           |
| 250×130             | Low wide: the wide layout with a smaller count and line, so a 4×2 on short launcher rows keeps its week row. Hafiz wird is never shorter than 130 dp. |
| 130×130             | Tile: flame and count centred at the top, one line below, Zayt filling the rest with only its feet cut.                                               |
| 110×100             | Small tile: flame, count and Zayt, with no line so Zayt's face is never cut; with Zayt off, the plain tile keeps its line.                            |
| 250×64 and 170×64   | Short: flame, count and line at the start; Zayt fills the height at the end, with only the twig tip and feet cut.                                     |
| 210×40              | Strip: one row with the line beside the count, and Zayt filling the height.                                                                           |
| 130×48              | Compact: a short 2×1 with the flame and count at the start and Zayt at the end, no line. With Zayt off, the strip's plain card.                       |
| 100×40              | Tiny: the flame with the count, or the line when there is no count. No Zayt, so neither is cut.                                                       |

Zayt's face sits low on the drop, so no layout crops more than the feet and the tip of the twig. Android 12 and later round every widget's corners. Before that, launchers do not, so the renderer draws the sky at the widget's reported size with the card's 16 dp radius.

With **Show Zayt** on, the background is the scene. With it off, each layout shows a plain card in the app's theme, the System theme following the launcher's day or night colours. An expired or unreadable timeline gets the neutral text layout.

The launcher picker shows a sample done day. **Settings → General → Home screen widget** uses the current local state for the native pin dialog where the launcher supports it. The one-time, post-session offer keeps its place behind rest, encouragement and reminder prompts.

## Count, flame and line

The count is the streak length, 0 included. On a scene it turns the flame's colour once today counts. The flame is lit once today counts and an empty outline at 0. A lit flame grows through seven stages, at 7, 14, 30, 50, 100 and 365 days, gaining a glow, a second tongue, a white-hot core and glints of light. While the streak waits for today, the flame is an outline whose ember grows with the urgency: small while there is time, glowing warm from 8 hours left, pulsing from 4 hours left and pulsing red in the last hour. The plain cards show the same ember, so urgency still shows with Show Zayt off. Paused days show the plain outline.

The line is short and follows the same urgency. A done day has none, since the lit flame and the gold scene already say it. With Show numbers off the count is hidden and no line names a figure, so a done day says "Done today". The plan and grace notes are spoken by TalkBack only.

The 4×2 widget from 130 dp tall adds a week row: the last seven days with today last, each under its weekday letter. A recited day is a small lit flame, a day kept by grace, an excuse or a pause is a soft dot, today's open day is the ember, and any other day is an empty ring. Nothing marks a day as missed.

## State, sky and Zayt

Each entry uses the same habit projection and review-left rules as Home. **Wird** means the page review for a page plan and the ayah review otherwise. An onboarding or review session already in progress keeps its place.

While today is open, urgency is the time left before local midnight. While yesterday can still be made up, it is the time left before the make-up cutoff: Dhuhr, or 12:30 without prayer times. Each level has two Zayt or line variants, and the widget picks one per level and day, so the faces change from day to day without flickering between refreshes. A level never shows the face the level before it showed that day.

| Level    | Time left | Sky on an open day           | Zayt                                                            | Line, numbers on                          | Motion                                         |
| -------- | --------- | ---------------------------- | --------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| Calm     | over 12 h | Morning                      | Standing or waving                                              | Wird time? · Today's wird awaits          | Blink                                          |
| Steady   | 8 to 12 h | Midday                       | Eager or waving                                                 | Keep it going · Keep your streak going    | Bounce or blink                                |
| Nudge    | 4 to 8 h  | Golden hour                  | Impatient or warm                                               | Keep your 12 days · Don't break 12 days   | Foot tap or blink                              |
| Urgent   | 2 to 4 h  | Dusk                         | Worried with a bead of oil sweat, or fretful and glancing aside | Save your 12 days · Your streak needs you | The bead drips, or a weight shift and a glance |
| Critical | 1 to 2 h  | Night                        | Anxious and trembling, or nervous on tiptoe, with its own light | Under 2 hours left! · 12 days at stake!   | Tremble, or darting eyes and a shiver          |
| Last     | under 1 h | Midnight, red at the horizon | Panicked with its light flickering, or frantic and hopping      | Last hour! · Now, or lose 12 days         | Tremble and flicker, or two quick hops         |

The make-up window has its own dawn, which turns rose from 4 hours before the cutoff and red from 2 hours before, with the same faces without the night halo. It says "Make up by 12:30", then "Last chance: 12:30" from 4 hours before the cutoff.

| State                    | Scene                         | Zayt                                     | Line                                     | Tap                                    |
| ------------------------ | ----------------------------- | ---------------------------------------- | ---------------------------------------- | -------------------------------------- |
| Begin                    | Dawn, or night in the evening | Wave, or glowing                         | Start your streak                        | Home                                   |
| After a lost streak      | Dawn                          | Lonely but hopeful                       | Start again today · Your wird misses you | Wird                                   |
| Open day                 | By level                      | By level                                 | By level                                 | Wird                                   |
| Make-up available        | Dawn, then rose, then red     | By level                                 | Make up by the cutoff, then last chance  | Wird                                   |
| Earning back, open       | By level                      | By level                                 | Earning back: n of 3                     | Wird                                   |
| Earning back, today done | Sunrise, or gold night        | Arms open                                | Today counts: n of 3                     | Home                                   |
| Done                     | Gold, or gold night           | Shimmer, or relieved after a late finish | None                                     | Home                                   |
| Safe, review left        | Gold, or gold night           | Warm smile                               | Review left today                        | Wird                                   |
| Milestone                | Gold burst                    | Milestone still                          | None, or review left                     | Wird if review remains, otherwise Home |
| Kept                     | Calm                          | Seated                                   | Streak kept for today                    | Home                                   |
| Paused                   | Calm                          | Seated                                   | Paused until the date                    | Home                                   |

The evening scenes for done and begin start at the evening start or 20:00, whichever comes first. A late finish is one with under 4 hours left before midnight, read from when today's habit day was recorded, or from the review session that earned it when an excuse came first. The widget never displays Quran text, an excuse category or a count of days away. These changes send no notification.

## Motion and event ownership

Calm stills blink slowly about every 4 and 6 seconds, two blinks with unequal gaps. The urgency faces loop their own short movement: a bounce, a foot tap, a drip, a glance, darting eyes, a tremble or two quick hops. The seated and celebrating stills stay still. From 4 hours left the waiting flame's ember pulses, faster and red in the last hour. Each is a frame list on an indeterminate ProgressBar inside the widget's RemoteViews, so the launcher runs it and Hafiz never wakes to animate.

A completed, locally committed review can carry a wird progress event: the minimum met, a day made up or a streak earned back. The widget lifecycle remembers it in memory for that local day and the first background transition consumes it. At backgrounding, Hafiz sends a fresh timeline with a one-time celebration request. Native plays the clip that the entry now showing calls for: the A07 turn on a milestone or the A06 hop on a done day, landing on the relieved brow wipe after a late finish. Other states keep the blink. Each clip ends on the entry's own still. Twelve seconds after publication, one follow-up refresh reads the latest state and returns to the blink. The launcher decodes every frame before a clip starts, which took about 7 seconds on a software-rendered emulator, so the hold leaves a slow launcher time to play it. Clip frames are packed at 400 by 480 pixels to keep that decoding and its memory small; the last drawing is the full-size still. Actual display timing depends on the launcher.

A new install, pin, resize, startup, clock change, sync or account restore shows the current still and blink. None of those creates a locally earned event, and a second trip to the launcher that day does not repeat one. Changing accounts or restoring local data discards a pending event. With system animations off, every widget is still. There is no sound or haptic feedback.

## Offline use, privacy and accessibility

Hafiz calculates up to seven local days from on-device data and publishes a bounded timeline into Android's app-private, no-backup storage. The widget chooses the current entry from it while the app is closed, and wakes at each urgency step before midnight and before the make-up cutoff, at midnight, the cutoff, the evening start, 20:00 and when later review comes due. Android may defer scheduled work. A timeline that would pass 64 entries ends early, and the widget asks for Hafiz to be opened at that point. After expiry, unreadable data or a time-zone mismatch, the widget says to open Hafiz and omits personal figures. A version 1 timeline stored before an update still renders in the new look, with a midday sky for open days, until Hafiz publishes again.

**Show numbers** controls the streak length, day counts and plan figures in the text and TalkBack label. The flame's stage still shows. A useful cutoff time or pause date can still appear. **Show Zayt** controls the scene and Zayt in every personal render and its pin preview. The launcher's generic catalog artwork is a design sample. English and Arabic use their own strings, digits and reading direction. Arabic moves the text to the right and Zayt to the left, and Zayt still waves with the same hand.

The entire card is one tap target and one TalkBack description, which keeps the full sentences: the streak, the line the screen shows, its detail and the plan or grace note. The scene, Zayt, the frames and the flame are decorative.

## Art and acceptance

The art comes from the Zayt studio's widget export on the `feat/zayt-widget-art` branch: fourteen scenes in a square and a wide crop, the calm stills with their blink frames, the urgency faces with their loops, and the done and milestone clips. To reproduce the Android resources, run `node scripts/render-widget-art.mjs /path/to/studio/zayt/widget/out` from the app checkout. It copies the files and writes the frame lists and their ProgressBar layouts, and turns the export's flame SVGs into the vector drawables and ember loops in `android/app/src/main/res/drawable`. `tests/unit/widget-resources.test.ts` checks that every scene, pose and flame JavaScript can send has its resources and is accepted by the Kotlin parser.

Acceptance covers both picker entries, every size in the table above, every state and urgency level, both directions, fixed and System themes with Zayt off, numbers off, reduced motion, expired data and tap routing. On a native widget host, watch the blink, a done hop and a milestone turn end on their stills, then repeat with reduced motion. Read the Arabic line and check the start edge at narrow widths. Check that the text, destination and accessible label remain useful with no art.

This specification covers Android home-screen widgets. An iOS WidgetKit implementation and a lock-screen surface would each need a separate product decision.
