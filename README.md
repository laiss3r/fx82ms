# fx-82MS calculator for Android and the web

A scientific calculator based on the Casio fx-82MS 2nd-edition key layout and workflow. The Android app is fully native Kotlin: native Android Views and a pure Kotlin calculation engine, with no WebView or JavaScript packaged in the APK. The repository also keeps a separate browser/PWA implementation at its root. This is an independent educational implementation, not an official Casio product or a bit-for-bit firmware emulator.

## Download the Android APK

Use the public [GitHub Releases page](https://github.com/laiss3r/fx82ms/releases/latest) and download `fx82ms-debug.apk`. APKs are debug-signed for sideloading/testing, not Play Store distribution. Android may ask you to allow installation from the app you use to open the APK. The v1.2.0 Android source is fully native Kotlin; public release `v1.1.1` is the earlier WebView build until a v1.2.0 release is published.

The repository is public at [github.com/laiss3r/fx82ms](https://github.com/laiss3r/fx82ms). GitHub Actions builds the APK on every push to `main`, and the workflow can also be run manually from the Actions tab.

## Key behavior and supported calculations

The key-by-key main/SHIFT/ALPHA reference is in [`docs/key-reference.md`](docs/key-reference.md). It maps the displayed keys and alternate functions, including the modifier keys, the MODE setup pages, and the SD/REG statistics menus.

The implementation includes COMP, SD and REG modes; six regression types; angle-unit setup and DRG▶ conversion; display precision; fraction and DMS entry/conversion; arithmetic, percentages, powers, roots, trig/hyperbolic/log functions, nCr/nPr, factorial, random, Rnd, engineering notation and Pol/Rec; Ans, A–F/X/Y variables, independent M memory, editing, replay and local persistence. SD/REG data is entered with M+ (DT), while `=` evaluates without recording; statistics, regression and data browsing/editing follow the selected mode. The native Kotlin engine provides COMP, SD and REG modes, expression editing/replay, memory and local persistence, with calculation/domain checks. Every tap has a subtle 8 ms vibration when supported (Android `Vibrator` in the APK, browser vibration API in the separate PWA).

## Run the PWA locally

Serve the repository root (PWA install/offline support requires HTTPS or `localhost`):

```sh
python3 -m http.server 4173 --bind 0.0.0.0
```

Open `http://localhost:4173` on a computer, or open the hosted HTTPS URL on Android and choose **Install app** / **Add to Home screen**. After the first load, the app shell and calculator code are cached for offline use.

## Tests

Run the calculator regression suite from the project root:

```sh
node --check app.js
node --check tests/calculator.test.js
node tests/calculator.test.js
```

The Node suite covers the separate browser/PWA implementation. Native Kotlin engine tests run with `gradle :app:testDebugUnitTest` and cover arithmetic, scientific functions, fractions, DMS, memory, persistence, SD statistics, regression, errors and power state.

## Android build workflow

The workflow is `.github/workflows/build-android-apk.yml`. It uses Java 17, Gradle and Android SDK setup, builds `assembleDebug`, and uploads the APK as the `fx82ms-debug-apk` Actions artifact. Tagged releases attach the APK to a public GitHub Release.

## Reference

The key markings and function behavior are based on the [Casio fx-82MS / fx-85MS / fx-220 PLUS / fx-300MS / fx-350MS 2nd-edition online manual](https://support.casio.com/global/en/calc/manual/fx-82MS_85MS_220PLUS_300MS_350MS_en/) and [official PDF](https://www.casio.com/content/dam/casio/global/support/manuals/calculators/pdf/004-en/f/fx-82MS_85MS_220PLUS_300MS_350MS_EN.pdf).
