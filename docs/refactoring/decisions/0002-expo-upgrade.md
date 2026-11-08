# ADR 0002. Defer the Expo SDK upgrade until after the modernization merge

Status accepted (RF045). Date 2026-11-08.

Hafiz runs Expo SDK 55 (Expo 55.0.32, React Native 0.83.10, React 19.2.0). Expo has since released SDK 56 (React Native 0.85, May 2026), SDK 57 (React Native 0.86, June 2026, described by Expo as a non-breaking step) and SDK 58 (React Native 0.88). SDK 58 adds iOS 27 support with the UIKit scene lifecycle, makes the strict TypeScript API and R8 minification of Android release builds the defaults, and changes fingerprinting. SDK 56 shipped a Hermes v1 memory and development-startup regression that Expo fixed in expo 57.0.9. Sources: [SDK 56](https://expo.dev/changelog/sdk-56), [SDK 57](https://expo.dev/changelog/sdk-57), [SDK 58](https://expo.dev/changelog/sdk-58), [upgrading to SDK 58](https://expo.dev/blog/how-to-upgrade-to-sdk-58).

Store requirements do not force the upgrade now. SDK 55 builds with compileSdk and targetSdk 36, which meets Google Play's API 36 requirement for new apps and updates from August 31, 2026 ([Google Play target API](https://developer.android.com/google/play/requirements/target-sdk)). The iOS 27 scene lifecycle matters once Apple requires building with the iOS 27 SDK, which on Apple's usual schedule is spring 2027.

Decision: stay on SDK 55 for this branch and upgrade straight to the then-current SDK (58 or later) in a separate branch after this one is merged. Reasons:

- This branch already changes native data loading (RF188) and Android rendering (RF184, RF185, RF189). An SDK change on top would mix two sources of device regressions in one review.
- Four local patches need revalidation against new versions: `expo-sqlite`, `react-native-css-interop` (RF185 press-style fix), `@tanstack/query-core` and `tailwindcss`.
- iOS verification is waived (RF042), and SDK 58's scene lifecycle is an iOS change that needs a device or simulator.
- SDK 56 to 57 is the regression-and-fix pair; stopping at 56 is not useful.

The follow-up is RF197. It needs the Android QA device gates used in this branch (cold start, first-run import, reader both views, review session, translations, page-view glyph rendering), the full unit and Chrome gate, and an iOS run before release. Reconsider earlier if a security fix ships only for newer SDKs or Apple moves its SDK deadline.
