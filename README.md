# Hafiz

Hafiz is a Quran memorization app built around one motto: Memorize through reflection. It combines a Mushaf reader, reflection tools, word-level study, tafsir, translations, private notes, and steady review tools.

Live preview: https://hafizquran.app

Hafiz is in early public preview. It is ready for a small group of people to view and try, but it is not a finished production release.

## Features

- QCF2/KFGQPC V2 page fonts for Quran display.
- Verse and page Mushaf views.
- Word meanings, morphology, i'rab, tajweed, qira'at data, and occurrences where available.
- Review tools, including FSRS-based scheduling.
- Optional account sync, reflections, leaderboard, and public profile features.
- Bilingual English/Arabic UI.

## Planned Features

Hafiz is still in early public preview. Planned work includes:

- More detail around daily wird, streaks, achievement milestones, and progress history.
- MP3 support and hadiths connected to individual ayahs.
- More functionality for private notes and reflection workflows.
- Reading utilities such as auto-scroll in vertical mode.
- Memorization utilities such as hiding and automatically revealing ayahs in page mode.
- Mutashabehat review support, either through a shared deck users can access or a user-built deck populated from the "add for review" ayah flow.
- Reflection Journey and a Reflection Feed, with the two experiences connected where useful.
- An interactive character to make guidance and encouragement feel more present.
- Broader tests and UI polish across screen sizes, themes, languages, and reading/review modes.
- A tested, high-quality Android application.

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
