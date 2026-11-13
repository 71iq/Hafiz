# Native configuration ownership

Decision date 2026-11-02. Hafiz keeps its committed Android project. The native build consumes android/, while app.json remains Expo/web metadata and the declaration of the mirrored subset below. This mission does not adopt Continuous Native Generation or run Prebuild over the existing native project.

Expo documents Prebuild as optional and warns that regeneration can overwrite manual native changes. Its build service also preserves existing native directories rather than regenerating them. This supports keeping an explicitly maintained native project. It does not prove Hafiz configuration parity. [Expo CNG documentation](https://docs.expo.dev/workflow/continuous-native-generation/).

## Owners

| App config field | Existing native owner and verification |
| --- | --- |
| name and version | res/values/strings.xml app_name and app/build.gradle versionName. Android versionCode remains independently native-owned. |
| android.package | app/build.gradle namespace and applicationId. |
| orientation and scheme | MainActivity manifest attributes and its browsable VIEW intent. Manifest queries are not deep-link declarations. |
| android.predictiveBackGestureEnabled | Application enableOnBackInvokedCallback. Native supportsRtl must stay true. |
| userInterfaceStyle | The current automatic declaration and AppTheme DayNight parent are checked. Runtime settings/themes, system appearance and device behavior are separate QA. |
| splash | Splash theme references, background color, resize-mode string and resource existence. Native density bitmaps remain native-owned. |
| icon and android.adaptiveIcon | Launcher manifest references, both adaptive backgrounds, declared source files and native resource existence. Generated bitmap equivalence is not checked. |
| plugins | The reviewed list is expo-router, expo-sharing, expo-asset, expo-audio, expo-notifications and expo-location. Installing a module/autolinking does not apply every config-plugin setting. Any plugin-list change requires a new ownership review. Review of 2026-11-13: expo-notifications and expo-location permissions arrive through their library manifests (notifications, boot-completed rescheduling, coarse and fine location); the notification icon (`drawable-*/notification_icon.png`, from the monochrome icon) and `notification_icon_color` are mirrored by hand, and the checker compares the color with app.json. expo-location's iOS permission text applies only if an iOS project is adopted. |
| ios | No ios/ project is committed. supportsTablet/icon are future generation inputs, not tested iOS native behavior. A new ios/ folder triggers ownership review. |
| web and experiments | Expo/Metro and Router metadata. They do not replace the committed Android manifest/resources. |

The current Android owner files are android/app/src/main/AndroidManifest.xml, android/app/build.gradle, the MainActivity.kt splash registration and android/app/src/main/res/. The web deployment workflow exports static web. scripts/ralph/build-android-debug.py compiles the committed Android project without Prebuild. The documented npm Android command remains Expo run:android; with the existing project its build uses that project. No native regeneration is part of this decision.

## Drift check and change procedure

Run npm run check:native-config after app.json or native metadata changes. The checker compares the mirrored textual settings and validates current resource references. Its fixture tests independently alter identity, version, orientation, scheme, appearance, back handling, splash, adaptive background, plugins, native RTL, missing files and malformed XML. It fails on drift or unrecognized required input. It does not synchronize or rewrite files.

For a native-affecting change, identify the native owner, update both intentionally mirrored declarations and verify the affected native build and behavior. Review config-plugin effects before applying them. Keep Android package/versioning/signing and protected assets within their separately authorized scope. A checker pass never authorizes a release or certifies native images, plugin effects or all config fields. Future CNG adoption requires an isolated comparison and review of all preserved native customizations before replacing this policy.

## Doctor finding and acceptance limits

Package alignment and duplicate-module findings are resolved through RF067, RF114, RF115 and RF116. Raw Expo install --check must pass. Doctor currently passes 19 of 20 checks and exits1 for the known non-CNG app-config ownership finding. Keep that raw output and check enabled, with no exclusion or suppression. RF008 accepts this explicit native ownership policy and its bounded drift check; it does not claim Doctor 20/20 or automatic app.json synchronization.

This decision resolves ownership ambiguity while leaving manual maintenance work visible. Native bitmap/source equivalence, startup splash/icon appearance, actual light/dark behavior, plugin effects, device interaction and iOS compilation remain unverified. RF040/RF041/RF042/RF048 retain native/device/UI acceptance. Android debug assembly across all four ABIs and the broad web/unit checks are recorded by RF116, not repeated as new runtime proof by this documentation/tooling slice. Security debtRF090 and lint/maintenanceRF044 remain separate and open. No app.json/native/resource/asset/signing/production change is made here.
