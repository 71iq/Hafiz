# Hafiz

Hafiz is an offline-first Quran retention app for iOS, Android, and web. It combines a Mushaf reader, word-level study tools, tafsir, translations, private notes, and FSRS-based spaced repetition.

Live preview: https://hafizquran.app

Hafiz is in early public preview. It is ready for a small group of people to view and try, but it is not a finished production release.

## Features

- Offline Quran reading from bundled local SQLite data.
- QCF2/KFGQPC V2 page fonts for Quran display.
- Verse and page Mushaf views.
- Word meanings, morphology, i'rab, tajweed, qira'at data, and occurrences where available.
- Flashcard review powered by FSRS.
- Optional account sync, reflections, leaderboard, and public profile features.
- Bilingual English/Arabic UI with RTL support.

## Public Pages

- About: https://hafizquran.app/about
- Privacy Policy: https://hafizquran.app/privacy
- Terms of Service: https://hafizquran.app/terms

## Issues And Contributions

Issues are welcome for bugs, content corrections, accessibility problems, and feature requests:

https://github.com/71iq/Hafiz/issues

Hafiz is not accepting outside code contributions or unsolicited pull requests yet. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Become A Donor

Donation support is planned, but donations are not being collected yet. There is no payment flow in the current public preview.

## Development

```bash
npm install
npm run typecheck
npm run build:web
npm run web
```

The web build is exported with Expo and deployed from `main`.

## Data And Notices

Hafiz source code is licensed under MIT. Bundled Quran text, fonts, translations, tafsir, tajweed, morphology, and related datasets remain subject to their original source terms.

See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
