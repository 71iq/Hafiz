# User cases

User flows in the current project, reviewed on 6 November 2026. Shared flows apply wherever the same control appears. Conditional flows require the relevant account, service, or feature to be enabled.

## Startup and shared interactions

- UI-01. Launch the app. Wait through font and database preparation, then enter the requested screen. A database failure replaces database-dependent screens with an error message.
- UI-02. Open the root URL. First-time users enter onboarding, returning users enter Home, and a failed onboarding-status lookup also opens Home.
- UI-03. Leave and reopen the app. Restore saved preferences and any signed-in session, then load local study data. A failed profile lookup can use a fallback account identity.
- UI-04. Lose connectivity. The offline banner appears while local study remains available. Reconnecting removes the banner and lets configured account sync resume.
- UI-05. Sign in, reconnect, or return to the foreground. Background sync shows syncing, synced, offline, or error status. Successful sync refreshes affected data, and an account-data restoration shows a temporary notice.
- UI-06. Open a shared sheet or dialog. It animates above the current screen, fits the viewport, and blocks background scrolling on web. Supported forms move above the software keyboard.
- UI-07. Dismiss a shared overlay through its close control, backdrop, web Escape, or native Back when allowed. Return to the underlying screen and restore web focus. Escape closes the top shared overlay first.
- UI-08. Open a confirmation. Cancel returns without applying the action. Confirm starts the action, disables duplicate confirmation, and prevents dismissal while the operation is pending.
- UI-09. Open a shared card-actions menu. Choose an enabled item to close the menu and run it, or dismiss outside it. The menu moves above its trigger when space below is insufficient.
- UI-10. Receive temporary action feedback. A toast appears, then disappears after its timeout. Achievement announcements use their own explicit dismissal flow.
- UI-11. Encounter a caught screen-render error. The fallback replaces that section. Select Try Again to render the section again.
- UI-12. Resize or rotate the viewport. Screens, lists, navigation, and overlays use their phone, tablet, or desktop arrangements while keeping the current route.

## Navigation and Home

- NAV-01. Use phone navigation to move between Home, Mushaf, Leaderboard, Progress, and Settings. The selected destination changes its active appearance.
- NAV-02. On a tablet-width screen, press, hover over, or focus the sidebar trigger or edge. The floating navigation opens. Leaving it hides it after a delay, and choosing a destination closes it.
- NAV-03. On a desktop-width screen, use the persistent sidebar. It also links to the reflection feed, reflection journey, and own profile. Wide Mushaf reading hides the sidebar and provides its own Home control.
- NAV-04. Open `/flashcards` or `/search` directly. Both replace themselves with Home. Search and deck review start through Home's controls.
- NAV-05. Open an unknown URL. Read the not-found message and follow its Home link through the normal root-entry flow.
- HOME-01. Enter Home. View today's due count, memorized count, wird streak, smart-deck counts, and journey progress. Returning from study or receiving synced records refreshes the displayed data.
- HOME-02. Select the saved reading-position card when present. Open Mushaf at its restored reading position.
- HOME-03. As a guest, use Home's account banner to open Login or Signup, or dismiss the banner for the current Home instance.
- HOME-04. Dismiss an achievement announcement. Mark that achievement as seen and show the next unseen announcement when one exists.
- HOME-05. Select the dashboard's Start review when cards are due, or select a nonempty deck. Open the review session for all eligible cards or that deck. A deck with only future cards can open an empty summary.
- HOME-06. Open a deck's configuration or card-list control without starting its review. The vocabulary deck appears only after vocabulary cards exist.
- HOME-07. Select the reflection-journey card. Open the journey and continue with its saved level and response state.

## Search and external Quran links

- SEARCH-01. Open search from Home or Mushaf. Close any word tooltip/detail, focus the search field, and show recent searches or the initial hint.
- SEARCH-02. Enter at least two normalized characters in Text mode. Search Arabic Quran text and English translation after the typing delay, or submit immediately with the keyboard. Show highlighted results grouped by surah, up to 200 results.
- SEARCH-03. Switch to Root mode. Search a root, lemma, full word, or partial word. Show occurrences grouped by lemma, with the first group expanded. Expand or collapse the other groups.
- SEARCH-04. Select a search result. Close search and the keyboard, then open or reposition Mushaf at the ayah. An occurrence result also identifies and highlights the matching word.
- SEARCH-05. Select a recent search. Restore its query and mode, rerun it, and move that query/mode pair to the front of the ten-entry history.
- SEARCH-06. Clear the query to return to history, or clear all history. Closing search clears its query, results, errors, and expanded groups while retaining the selected search mode.
- SEARCH-07. Enter fewer than two normalized characters without running a query, leaving an empty results area. A completed query with no matches shows an empty-result message; a failed query shows Retry for the current query.
- SEARCH-08. Follow `/open?surah=2&ayah=255` or the equivalent app link. Briefly show the link bridge, then replace it with Mushaf at the requested ayah. The pending target takes priority over the saved position.
- SEARCH-09. Follow an open link with a missing or rejected surah/ayah parameter. Open Mushaf without applying that target. The bridge accepts surahs 1 to 114 and positive ayah numbers before reader lookup.

## Onboarding

- START-01. Begin onboarding. Move through Welcome, memorized-surah selection, and the deck summary with animated transitions. Go back before the deck has been saved.
- START-02. Search the surah list by number or Arabic/English name. Select or deselect surahs, select all, or clear all. Update the selected-surah and ayah totals. No matches shows an empty list.
- START-03. Continue with at least one selected surah. Review the totals, then create the smart-deck scope. Show saving, saved confirmation, or a retryable save error. Empty selection disables Continue.
- START-04. After creation, choose Start review. Save onboarding completion and open the review session. Alternatively, choose Continue to enter Home.
- START-05. Skip from either later onboarding step. Save onboarding completion and enter Home without requiring deck creation. A completion-save failure leaves the step open with an error.

## Mushaf reading and movement

- READ-01. Open Mushaf in the saved verse/page mode. Restore a matching saved position when available, otherwise begin at the initial position. Scroll to update the saved reading location.
- READ-02. Switch from page view to verse view at the current page's first ayah. Switch back to the page containing the top visible ayah.
- READ-03. Read continuous vertical pages, or use the page-view menu to select horizontal pagination. Choosing a direction closes the menu and changes page movement.
- READ-04. Turn horizontal pages by touch swipe, mouse drag outside selectable Quran words, or horizontal wheel/trackpad movement. Short gestures return to the current page. The first and last pages bound movement.
- READ-05. On web, use ArrowLeft to advance and ArrowRight to go back in page view, in either UI language. In vertical page view, ArrowDown/ArrowUp move forward/backward. Text fields retain their arrow keys.
- READ-06. Drag, scroll, or wheel the page rail to preview a page, then release or settle to commit the jump. The rail is available in normal page reading.
- READ-07. Open Go to from the page rail. Choose Surah or Juz, filter by number or Arabic/English name, and select an entry to close navigation and jump. Switching tabs clears the filter. Empty matches and data-load failures have their own states.
- READ-08. Open a surah header's information panel. Read its localized information or loading/unavailable state, then return to the reader.
- READ-09. Scroll down to hide reader controls and up to reveal them. On phone/tablet, tap a non-control reading area to toggle the controls. Text selection and control presses avoid this toggle.
- READ-10. Arrive from search, bookmarks, notes, progress, reflections, or a word occurrence. Scroll to the ayah and optional word, show its target highlight, and clear that highlight on the next reader pointer/touch interaction.
- READ-11. Use the reader Home control. Leave Mushaf and open Home with the latest reading position available for resumption.
- READ-12. Wait for Quran data or page fonts. Render reading content when ready. Some reader load failures leave missing content without an on-screen Retry action.

## Memorization and focus

- HIFZ-01. In verse view, hide verses and tap a hidden ayah to reveal it. Turn hiding off and on to reset revealed ayahs.
- HIFZ-02. In page view, enable Hifz. Hide words and replace the page rail with memorization controls. Reveal the next ayah or hide the previous/partially revealed ayah. Boundary controls disable when no action remains.
- HIFZ-03. Start automatic word revelation, adjust its speed, then stop it. Manual reveal/hide stops automatic progress.
- HIFZ-04. Finish automatic revelation on a page. Stop there, or advance when the saved auto-advance preference permits it. Stop at page 604. Manual navigation resets revelation; switching to verse view disables page Hifz.
- FOCUS-01. Enter focus mode from vertical page view while Hifz is off. Hide normal navigation and start automatic scrolling. Pause/resume, adjust speed, show the focus controls, or exit to normal reading.
- FOCUS-02. Touch, scroll, navigate, open ayah actions/word detail, or open a reading panel during focus mode. Pause automatic movement. Reaching the end pauses with feedback; incompatible reading settings exit focus mode.

## Ayah actions and details

- AYAH-01. Press an ayah reference in verse view, or long-press a page ayah marker. Open the ayah-action panel.
- AYAH-02. Use the action panel to copy the ayah, add/remove its bookmark, choose/change a highlight color, or remove an existing highlight. Successful actions close the panel and show feedback; pending actions prevent repeated writes.
- AYAH-03. From the same panel, choose reflection or private note. Open its editor above the action panel for the selected ayah. Closing the editor closes both panels.
- AYAH-04. Open ayah detail through a page-marker click on web, a marker double-tap on native, or a verse-view content pill. A pill selects its corresponding detail tab.
- AYAH-05. In detail, move to the previous/next ayah while keeping the selected tab. Disable movement at Quran boundaries.
- AYAH-06. Switch detail tabs between tafsir, translation, qiraat, private notes, reflections, and enabled Hadith content. Arabic UI omits Translation and moves an active Translation tab to Tafsir.
- AYAH-07. Read the selected translation in its text direction, or its loading placeholder. Read tafsir, switch among available sources, or open Manage sources and use the shared source-selection flow.
- AYAH-08. Read qiraat for the ayah and any covered-ayah group. Loading and missing-content states replace the text when needed.
- AYAH-09. With Hadith content enabled, read references, load another page, retry an initial failure, or view empty/unavailable content. Cached references can remain visible after refresh failure.
- AYAH-10. From a verse card or detail, copy the ayah/reference/link, toggle its bookmark, or use enabled audio playback. Copy/bookmark failures show feedback. Controls with share icons copy to the clipboard.

## Words and browser text selection

- WORD-01. On web, press a visible word to show its Arabic/English meaning tooltip. Press it again to dismiss, select another word to replace it, or scroll/press elsewhere to close it. Press the tooltip to open word detail.
- WORD-02. Long-press a visible word or right-click it on web to open detail. Horizontal touch-web pages retain browser long-press text selection. Hidden words ignore word actions; native does not show the floating tooltip.
- WORD-03. In word detail, browse previous/next words and view their reference and frequency, plus root/lemma metadata in Arabic UI. Switch Meaning, I'rab, Tajweed, Tasreef, and Occurrences tabs. Boundary arrows disable; closing resets the initial tab.
- WORD-04. Open the current word's ayah detail above the word sheet. Meaning starts Translation where available, otherwise Tafsir. Other word tabs start Tafsir. Close ayah detail to return to the word sheet.
- WORD-05. Read the word translation/transliteration or Arabic meaning. Add its meaning to vocabulary, then show saving/saved feedback or a retryable failure.
- WORD-06. When Arabic meaning is absent, enter a custom meaning and save it locally. The saved meaning gains the normal vocabulary action. Empty text cannot save; a failure retains the editor and error.
- WORD-07. Read I'rab with the selected word highlighted and scrolled into view, or read Tasreef morphology. Loading/missing-data states replace unavailable content.
- WORD-08. Expand or collapse individual Tajweed rules in the selected UI language. Show the no-rules state when none applies.
- WORD-09. Select a root occurrence. Close word detail and move Mushaf to that ayah/word with a highlight. Missing roots or occurrences show an empty state.
- SELECT-01. On web, select Quran text with mouse, keyboard, or touch. Copy through the custom menu or normal clipboard command to obtain Unicode Quran text and references.
- SELECT-02. Open the selected-text color picker and highlight the exact selected words. Show copy/highlight errors when an operation fails. Scrolling or outside interaction dismisses the selection menu; active browser selection suppresses page dragging.
- SAVED-01. Open bookmarks. Select one to close the sheet and navigate to its ayah, or remove one while keeping the sheet open. Show an empty list, deletion progress, or success/failure feedback as applicable.

## Recitation

- AUDIO-01. With Quran Foundation content enabled, play a single ayah from verse view or detail. Pause/resume it, or select another ayah to replace playback. Single-ayah playback cancels a playing range. Loading blocks repeated playback requests.
- AUDIO-02. Open recitation settings. Start with the visible ayah, choose one ayah, an inclusive start/end range, or the current surah, then select a reciter through the shared reciter picker.
- AUDIO-03. Set whole-range repeats, repeats per ayah, and delay. Start playback, watch the active ayah and progress/repeat counters, then stop or let it finish. Closing the settings sheet leaves playback running.
- AUDIO-04. Submit a malformed reference, nonexistent single-ayah reference, reversed/empty range, or failed playback request. Keep the recitation sheet open with feedback. Unavailable or misconfigured audio also reports failure.
- AUDIO-05. Background the native app during playback. Pause audio. Returning makes audio available without automatically issuing a new play command.

## Deck setup and card management

- DECK-01. Configure a built-in retention, mutashabihat, similar-tails, qiraat, or reasons-of-revelation deck. Choose all Quran, selected surahs, or selected juz numbers.
- DECK-02. Add/remove surahs and edit optional start/end ayah ranges in nested selectors. Return with Done to the parent draft. Empty scope, noninteger/out-of-bounds ranges, or reversed ranges prevent Apply.
- DECK-03. In built-in deck configuration or vocabulary review settings, adjust daily/new-card limits, target retention, maximum interval, fuzz, short-term scheduling, and learning/relearning steps. Steppers enforce their configured bounds.
- DECK-04. Enter scheduling steps with supported minute/hour/day units, including Arabic units. Blank text removes steps; unparseable text uses fallback steps rather than a validation error.
- DECK-05. Set reviews first, new cards first, or mixed order. Sort reviews by due date, oldest, newest, or random order, and new cards by creation or random order.
- DECK-06. In vocabulary settings, enable Arabic and/or translated-meaning answers while keeping at least one enabled. Open a setting's explanation and dismiss it to return to the same draft.
- DECK-07. Apply built-in configuration or save vocabulary settings. Save changes, refresh Home, and close. Built-in configuration also prepares eligible cards. Loading/save failures show an error. Closing without Apply/Save abandons draft changes.
- DECK-08. Open a deck's card list. Read card references, state, and due dates, with horizontal table scrolling on narrow screens. Loading, empty, and failed-load states are distinct.
- DECK-09. Combine card text search with All, Due, Scheduled, New, Learning, Review, Relearning, Marked, Suspended, or Buried filtering. Show matching rows or no matches. Closing resets search/filter state.
- DECK-10. Open a card menu and mark/unmark, suspend/unsuspend, or bury/unbury it. Save the change and refresh list/Home counts, or show action failure.
- DECK-11. Choose Reset progress or Delete from a card menu. Cancel or confirm. Confirmed actions reset/remove the card and refresh counts. Generated virtual cards cannot be deleted.
- DECK-12. Set a card's due date. Edit and save, or cancel. Reject invalid or past dates, then refresh the list/counts after a valid save.

## Review sessions

- REVIEW-01. Start a normal review from Home or onboarding. Load eligible cards using deck scope, scheduling limits, and ordering. An empty/exhausted queue opens the zero-card summary; a load failure uses the summary with an error.
- REVIEW-02. Read the card front and reveal its answer. Step through available answer sides, then grade. Missing sides are skipped; a card with no available answers goes directly to grading.
- REVIEW-03. Review an ayah or vocabulary card. Answer sides can contain next/previous ayah, translation, tafsir, surah name, or enabled Arabic/translated word meanings. Vocabulary cards highlight the word in its ayah context.
- REVIEW-04. Review a specialty card. Reveal matching-ayah comparisons, similar endings, qiraat variants, or revelation context/source according to its smart-deck type.
- REVIEW-05. Choose Again, Hard, Good, or Easy with the displayed interval. Save scheduling/activity, then advance. Cards due again today can return later in the same session. Save failure keeps the current card for retry.
- REVIEW-06. Open current-card actions and mark/unmark the card. Return to the same card. Suspend or bury instead to remove it from the queue and advance or finish.
- REVIEW-07. Delete or reset the current card through confirmation. Cancel leaves it unchanged. Delete advances; reset returns the same card to its front with reset progress.
- REVIEW-08. Edit the current/first available answer mode. Save personal nonblank answer text, save blank text to restore its default, or cancel and return to the card.
- REVIEW-09. Set a valid due date of today or later for the current card. Save and remove it from this session, then advance or finish. Invalid input stays in the editor.
- REVIEW-10. Press X during an active session. Return directly to Home without an exit confirmation or partial-session summary. Already saved grades and card changes remain.
- REVIEW-11. Finish the queue. Read reviewed/new/review/relearning totals, duration, next review, and wird status, then choose Done to return Home.
- REVIEW-12. Open `/flashcards/vocab` directly. Load due vocabulary cards, or all vocabulary cards when none is due. Reveal, rate, and advance to its summary. Back/X exits immediately; Delete removes the current card without confirmation. Save/delete errors retain the card, while initial load failure falls through to its summary.

## Reflection journey

- JOURNEY-01. Open the journey. Select the first available/draft level automatically, otherwise the first level. View progress, level status, lesson blocks, response prompt, and saved text. No levels shows an empty state.
- JOURNEY-02. Select an unlocked level from the phone level strip or wider side list. Completed levels remain accessible; later incomplete levels stay locked until their predecessor is complete.
- JOURNEY-03. Read lesson text, Quran, translation, and tafsir. Press an ayah/text row to open ayah detail, starting Translation for translation blocks and Tafsir otherwise. Block/font loading shows feedback; failed loads can leave missing content without Retry. Recitation blocks display Coming soon.
- JOURNEY-04. Write a response and save a draft. Show character count, saving, saved status/toast, or an error. Return later to load the saved draft.
- JOURNEY-05. Complete a response with 10 to 5000 trimmed characters. Save completion, update progress, and unlock the next level. Too-short input shows validation; save failure keeps the response.
- JOURNEY-06. Edit a completed response and save it complete again. Retain its completion status. Use Open next when an unlocked successor exists; the final level has no next action.
- JOURNEY-07. Switch levels or leave through Home without saving. Discard unsaved response text without a confirmation, then load the destination level's saved response when selected.

## Progress and achievements

- PROGRESS-01. Open Progress or own profile Overview. View available local study totals, wird, activity, default-deck progress, surah progress, and achievements. Refresh relevant figures after saved review activity or pulled sync records.
- PROGRESS-02. Press an activity-heatmap day. Show its date and review count. Press the same day to hide the tooltip, or another day to replace it.
- PROGRESS-03. Browse own surah progress and select a surah to open Mushaf at ayah 1. From Progress, use View all to open the full surah list, then select or dismiss it.
- PROGRESS-04. Open View all achievements from Progress. Browse grouped unlocked badges and locked progress, then dismiss. Individual charts, statistics, and badges remain read-only.
- PROGRESS-05. View empty study history. Show zero/empty progress or dedicated empty text. Some failed local queries also fall back to empty values; no general progress Retry control appears.
- PROGRESS-06. As a guest with account sync configured, use Progress's sign-in prompt to open Login while keeping local progress available.

## Community feed and reflections

- FEED-01. Open the reflection feed. Show posts, an empty feed, a retryable load failure, or an unavailable-service message according to the response/configuration.
- FEED-02. Search reflections while retaining the chosen location and sort. Update after the typing delay or submit immediately from the keyboard. Clear to restore the unsearched feed; no matches shows a search-empty state.
- FEED-03. Choose None, Surah, or Juz filtering, then All or a location. Changing filter type clears prior locations. Choosing a location closes the picker and reloads the feed.
- FEED-04. Sort by Newest, Oldest, Most popular, or Least popular. Close the picker and reload. Pull to refresh the current selection, or Load more until no further page exists.
- FEED-05. Press a post body/comment control to open the full reflection and comments. Press its ayah reference to open Mushaf at the reflection's first ayah.
- FEED-06. Press an author on a reflection or comment. Open own profile for the signed-in author, otherwise that author's public profile.
- FEED-07. As a signed-in user, like/unlike a reflection. Update its icon/count immediately, then keep the result or roll back with an error. Disable repeated actions while pending.
- FEED-08. As a guest, like a feed post to receive a sign-in-required toast. Like from an ayah's reflection section instead to open Login.
- FEED-09. As a signed-in user, toggle a reflection's report menu, or choose Report to close it and submit. Disable repeat reporting after success or show failure. Guests have no report menu.
- FEED-10. In ayah detail, open the already expanded reflection list. Read posts, handle loading/empty/retry states, load more, or use See all to open the feed. An unconfigured service omits this section.
- WRITE-01. Start a reflection from an ayah's action panel or reflection list. A guest sees a login prompt that closes the editor and opens Login. A signed-in user sees the reference and text editor.
- WRITE-02. Enter 10 to 5000 characters and publish. Enable Submit only for valid content, show publishing, then close/clear the editor and refresh reflection counts/lists. A failed publish preserves text and shows the error.
- WRITE-03. Close the reflection editor without publishing. Clear its draft/errors without a discard confirmation.
- COMMENT-01. Open comments for a reflection. Show loading, comments, empty content, or load failure. Choose Popular, Oldest, or Newest, then reload; Load more appends further comments.
- COMMENT-02. As a signed-in user, enter a nonblank comment up to 2000 characters. Send by button, Enter, or keyboard Send. On success add it, clear the composer, and increment the count; failure retains the text.
- COMMENT-03. As a signed-in user, like/unlike a comment. Update its icon/count, then confirm or roll back with an error. Guest likes show a toast in feed comments and do nothing in ayah comments. Pending actions disable repeated likes.
- COMMENT-04. As a guest, use the comment login prompt. Close comments and open Login. Closing/reopening comments or selecting another reflection clears drafts and temporary state while retaining the selected sort.

## Private notes

- NOTE-01. Open an ayah's private-notes section without requiring an account. Read existing notes, an empty list, or a load error, then add a note or select one to edit.
- NOTE-02. In the shared note editor, enter 6 to 10000 trimmed characters. Save locally, close the editor, and refresh notes. Invalid text disables Save; duplicate/save errors retain the draft, and editing clears the error.
- NOTE-03. Cancel/close a note editor. Discard unsaved text without confirmation. Reopening loads the saved content.
- NOTE-04. Delete a note from an ayah's list. Delete immediately without confirmation, disable that pending action, then refresh the list or show failure.
- NOTE-05. Open own profile's Notes tab. View its four-note preview, loading/empty/error state, or View all when more notes exist. The full-list sheet shows all notes.
- NOTE-06. From profile notes, open the note's ayah or edit the note. Close the full-list sheet first, then open Mushaf at the note's first ayah or the shared editor.
- NOTE-07. Delete a profile note. Close the full-list sheet and ask for confirmation. Cancel leaves the note, while confirmed deletion refreshes notes or shows failure.

## Profiles and leaderboard

- PROFILE-01. Open own profile from Settings/sidebar, or a public profile from community/leaderboard. After database preparation, open the profile sheet. Close to return to the previous screen, or Home when there is no back history.
- PROFILE-02. Open own profile as a guest. Choose Login or enabled Signup, close the profile, and enter authentication.
- PROFILE-03. Open another user's profile. Show loading, its public overview/badges/activity/surah progress, or a missing/failed-profile state. Public surah cards are read-only.
- PROFILE-04. On own profile, switch Overview and Notes. Open Edit to change the display name, bio, country, or photo. Display name allows 60 characters; bio allows 280 and shows its count.
- PROFILE-05. Open the country picker, search English/Arabic names or codes, then choose or clear the country. Show no matches when necessary, or close the picker without selecting.
- PROFILE-06. Change the photo. Request permission, then handle denied permission, picker cancellation, or a square-cropped image preview. Remove photo shows a placeholder draft; selecting another image replaces it.
- PROFILE-07. Save a changed profile. Upload a new photo when needed, save the identity, and show confirmation while keeping Edit open. Failed uploads/saves preserve the draft. Unchanged/busy forms disable Save.
- PROFILE-08. Close and reopen Edit within the same profile instance. Retain unsaved draft fields. Leaving the profile ends that draft instance.
- RANK-01. Open Leaderboard and choose Daily, Weekly, All time, or Streak. Show loading, results, empty content, a retryable error, or unavailable service. Streak uses days; the other tabs use points.
- RANK-02. Browse guest leaderboard results limited to ten entries and use the login prompt. Signed-in users see all returned entries and their own entry highlighted.
- RANK-03. On wide layouts, select a top-three podium card, or select a leaderboard row. Open own/public profile. Pull to refresh the active leaderboard; signed-in refresh also publishes local score/profile totals.

## Authentication

- AUTH-01. Open Login. Enter a valid email and password of at least six characters, then submit. Show pending controls, open Home on success, or retain the form with validation/credentials/service errors.
- AUTH-02. Move through auth fields with keyboard Next and submit from the final field. Toggle each password field independently between visible and hidden text.
- AUTH-03. Move between Login and Signup by replacing the auth route, open Forgot password from Login, or use an auth screen's Back control to return.
- AUTH-04. Sign up with email, a username of 3 to 20 ASCII letters/digits/underscores, optional display name, and a password of at least six characters. Show field errors, already-registered feedback, email-confirmation notice, or a signed-in return to the previous screen.
- AUTH-05. From the signup confirmation notice, resend confirmation. Show pending, successful resend, or failure while retaining the email awaiting confirmation.
- AUTH-06. Request a password-reset email. Validate the address, send it, and show pending, confirmation, or failure.
- AUTH-07. Open a valid reset link, establish its session, and submit matching passwords of at least six characters. Update the password, sign out, and open Login. Invalid/missing web tokens disable Update with an error.
- AUTH-08. Choose an available Google, Apple, Facebook, or Quran Foundation sign-in provider. Disable provider controls during handoff, open external authentication, then return with a session, cancellation, or error. Native cancellation returns without an error notice.
- AUTH-09. Open authentication without a configured account service. Show the unavailable state. Disabled email flows redirect Signup/Forgot/Reset to Login and hide their links; disabled social login removes provider controls and shows limited-service feedback.

## Preferences and connected accounts

- SET-01. Open Settings and choose General, Content, Account, or About. Show that category and update its URL parameter. A missing/invalid category selects General.
- SET-02. Choose English or Arabic in General. Update labels, layout direction, alignment, and direction-sensitive controls, then retain the language across visits.
- SET-03. In General or reader settings, choose White, Beige, Dark, AMOLED, or System. Apply the appearance immediately and save it. System appearance follows the device's light/dark mode.
- SET-04. Change the Quran font in General or reader settings. General offers QCF2, V4, and V4 Tajweed; reader settings use a base-font picker and Tajweed switch. Update the Quran preview/reader and save the choice.
- SET-05. Choose Automatic, Light, Dark, or Sepia ayah-marker styling when using V4. QCF2 hides/disables this control according to the settings entry point.
- SET-06. Increase/decrease Quran font size within its bounds. Update the preview/reader and save. Horizontal page view fits its own size; reader settings disable the stepper there, while General shows the fitted-page explanation.
- SET-07. In General, choose verse/page reading and vertical/horizontal page movement. Save both choices for subsequent reading. The reader's mode controls use the same preferences.
- SET-08. Open translation selection from Content. Choose a language, wait for any import, then close with that selection active. Failure leaves an error and falls back to English. Other choices disable during selection.
- SET-09. Open tafsir selection from Content, reader settings, or ayah detail. Choose an available source and close, or download/import another source with progress. A download leaves the picker open; failure retains the previous source and reports the error.
- SET-10. With recitation content enabled, open the reciter picker from Content or recitation settings. Load available reciters with a bundled fallback, select one, close the picker, and retain that preferred reciter.
- SET-11. Open Account. A signed-in user can open their profile or choose Logout. Confirm logout to become a guest, or cancel to retain the session. Guests can open their profile, Login, or enabled Signup.
- SET-12. With account service and Quran Foundation sync enabled, connect/reconnect through external authorization. Return through `/auth/qf-callback` to Settings with a connected state or provider/missing-parameter/completion error.
- SET-13. After a successful connection, run the initial sync. Show connected, linked-without-sync, disconnected, or reauthentication-needed status with its result message. Connection callbacks clear their temporary URL parameters.
- SET-14. From a connected account, run manual Quran Foundation sync or disconnect it. Disable actions while pending, update connection status/result feedback, and allow reconnection when required.
- SET-15. Open About settings to reach About, Privacy, Terms, Credits, or GitHub issue reporting. A failed external launch shows feedback. Become a Donor opens an information dialog that can be dismissed.

## Public and direct-access pages

- PUBLIC-01. Open About, Privacy, Terms, or Credits directly or through Settings. Read the page, switch among the four public pages, return with Back, or use Home through the root-entry flow.
- PUBLIC-02. Toggle a public page between English and Arabic. Update its content/direction and cache the language for later public-page visits.
- PUBLIC-03. Follow a public-page internal link, source link, GitHub issue link, or email link. Internal links open their app route; external links open the browser/mail handler. Failed launches show an inline error.
- PUBLIC-04. Open `/zayt-preview` directly. Show animation loading, the running preview, or a load-error message. Back returns to the previous screen or the root route.
- PUBLIC-05. Open `/qa-ready` directly. Display database waiting, ready, or error status. This diagnostic page has no study controls.
