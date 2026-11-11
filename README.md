# fx-82MS style calculator

A responsive, touch-first scientific calculator inspired by the Casio fx-82MS 2nd edition layout. It works in a mobile browser and can be installed to an Android home screen as a lightweight PWA. Once loaded, the calculator shell and code are cached for offline use.

## Run it

Serve this folder from a local web server (PWA installation and offline caching require HTTPS or `localhost`):

```sh
python3 -m http.server 4173 --bind 0.0.0.0
```

Open `http://localhost:4173` on a computer, or open the hosted HTTPS URL on Android.

## Install on Android

1. Open the hosted HTTPS page in Chrome.
2. Tap **Install app** if it appears, or use Chrome's menu → **Add to Home screen** / **Install app**.
3. The app opens in a standalone portrait window and keeps its calculator assets available offline after the first visit.

## Build a downloadable Android APK with GitHub Actions

The Android project is in the root of this folder. The workflow at `.github/workflows/build-android-apk.yml` builds an installable **debug APK** on every push and can also be started manually.

1. Install GitHub CLI and authenticate privately with `gh auth login` (it opens a browser flow; no token needs to go into this project).
2. From this folder, run `./publish-to-github.sh fx82ms`. It initializes Git, creates the public `fx82ms` repository, pushes the project, waits for the APK workflow, and downloads the APK only if the build succeeds. If you prefer, create/push the public repository manually and use **Actions → Build Android APK → Run workflow**.
3. The script saves `app-debug.apk` in a timestamped `apk-download-*` folder. Install it on Android (Android may ask you to allow installs from the files app).

The APK bundles the calculator locally in a small Android WebView, so the calculator itself does not need a network connection. This is a debug-signed APK for sideloading/testing, not a Play Store release build.

## Included controls

- Arithmetic, parentheses, replay history, cursor editing, reciprocal, factorial, powers, roots, fractions, percentages, scientific notation, logs, trigonometry, inverse/hyperbolic functions, DMS, polar/rectangular conversion, random, angle units, variables and independent memory.
- COMP, SD and REG modes; SD summaries and linear/log/exp/power/inverse/quadratic regression data entry.
- Touch controls and hardware keyboard shortcuts (Enter, digits, operators, arrows, Shift, Alt).

Reference: [Casio fx-82MS / fx-85MS / fx-300MS / fx-350MS User's Guide (2nd edition)](https://www.casio.com/content/dam/casio/global/support/manuals/calculators/pdf/004-en/f/fx-82MS_85MS_220PLUS_300MS_350MS_EN.pdf).

This is an independent educational implementation of the fx-82MS-style workflow; it is not an official Casio application and is not a bit-for-bit firmware emulator.
