# Settings subscription measurements

RF-037 measures the existing settings owner before any selector or context split. It adds a test and this report. SettingsProvider, useSettings, persistence and reader production code remain unchanged. No Zustand copy of persisted settings or new context API is introduced.

The sample uses the real SettingsProvider, original useSettings return value, writeUserSetting, SurahHeader and memoized MushafPage. It also has memoized font, theme and setter-only consumers, plus a memoized control that does not read settings. The reader page has one structural basmallah line and no ayah rows. These are representative subscription fixtures, not a full reader or review-session workload.

The test wraps each real useSettings call with a layout effect. The effect increments a counter after a committed render and returns the original context value unchanged. It does not run a setter or create another persisted state owner. React documents that an effect without a dependency array runs after each component commit, and that memo does not block fresh context values. See [useLayoutEffect](https://react.dev/reference/react/useLayoutEffect) and [useContext](https://react.dev/reference/react/useContext).

The raw unit is one committed hook effect, not one unique component. SurahHeader reads settings twice, through useStrings and its own fields, so its raw counter is two for one ordinary update. The other sampled consumers each have one hook read. The control counts its own layout effect. Do not sum these counters and report them as a number of components or frames.

After hydration and frame-queue settlement, the following results repeat from both English and Arabic initial settings.

| Changed input                             | Font read | Theme read | Setter read | Header reads | Page read | Control | In-memory writes | Sync intent |
| ----------------------------------------- | --------- | ---------- | ----------- | ------------ | --------- | ------- | ---------------- | ----------- |
| Font index 2 to 3                         | 1         | 1          | 1           | 2            | 1         | 0       | 1                | 0           |
| White theme to dark                       | 1         | 1          | 1           | 2            | 1         | 0       | 1                | 0           |
| UI language to the other locale           | 1         | 1          | 1           | 2            | 1         | 0       | 1                | 0           |
| Daily review limit 20 to 30               | 1         | 1          | 1           | 2            | 1         | 0       | 1                | 1           |
| Focus speed 1 to 1.25                     | 1         | 1          | 1           | 2            | 1         | 0       | 1                | 0           |
| Parent rerender with changed control text | 1         | 1          | 1           | 2            | 1         | 1       | 0                | 0           |
| Invalid font indices -1 and 10            | 0         | 0          | 0           | 0            | 0         | 0       | 0                | 0           |

Repeating each setter with its current value produces zero new hook effects in this fixture. The existing persistence write still occurs once more. The daily review limit also produces one more mocked sync intent. This report does not claim that a repeated setter avoids all work.

Every mount has positive counter observations before the counters reset. A changed control prop then produces a control effect, while the same control stays at zero during settings updates. That parent rerender also publishes a new context value with unchanged sampled setting fields and stable setter identity. The setter-only consumer receives updates even though its callback identity stays the same. The source currently publishes one complete object as the provider value.

The first instrument used React Profiler callbacks. Its mount callbacks worked, but the tested context-only updates produced no callbacks despite the displayed font index changing. That instrument failed ten cases and is not used for the table. A minimal control preserved the mount and displayed-value evidence. Do not infer a non-profiling build or zero reader renders from that failure. The replacement measures hook commit effects and has explicit mount/update controls. The first capture also failed react-hooks/globals because it assigned during render. Capture now runs in a layout effect without disabling the rule. All failed fixture sources and logs remain in .refactor-baseline/rf037-settings-renders-v1/.

Final preparation passes 14 focused cases, strict types, zero-warning lint and test formatting. Removing the font-index or daily-limit state update from the original provider makes two cases fail each. Both mutations are temporary and the provider restores byte for byte. The restored 14 cases and the cold suite of 87 suites/889 tests pass without skips. readiness.json identifies the exact final artifacts and logs. All controller commands, a separate stronger review and primary acceptance still have to pass.

Keep the current architecture for now. The counts demonstrate broad subscription updates, including for fields a sample does not read. They do not measure the cost of those updates or establish user-visible jank. A selector split or memoized provider value needs a separate before/after plan if RF-039 runtime profiling shows a material cost. No performance improvement is claimed here.

The fixture controls database storage and sync intent in memory, NativeWind scheme/variables, font APIs, selection, WordToken, SurahInfoModal, viewport/direction and frame scheduling. It preserves the real provider and persistence decisions. Platform.OS is set to the Android branch in Jest; this is not an Android device run. It does not execute real SQLite, translation imports, page fonts, browser layout, large reader content, full settings/review routes, native devices or network sync. Durations, frame rate, payload memory and startup time are not measured. RF-039 retains full reader/review performance work. No new clean Knip/audit or duplication result is claimed.
