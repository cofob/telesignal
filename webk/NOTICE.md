# Telegram Web K provenance

This directory vendors [morethanwords/tweb](https://github.com/morethanwords/tweb) (Telegram Web K), branch `master`,
commit `2e4bbb52b6aec5e95ee32e5c2882c1f05de32200` (2026-11-11), licensed under GPL-3.0-only (`LICENSE`).
TeleSignal ships it as its second frontend at `/k/`; `docs/signal/ITERATIONS.md` section 11 tracks the port.

## License

Web K is GPL-3.0-only. The rest of the repository is GPL-3.0-or-later (`package.json`), and the vendored libsignal
crates (`rust/libsignal`) are AGPL-3.0-only. GPL-3.0-or-later code may be combined with GPL-3.0-only code, and GPL-3.0
section 13 allows combining GPL-3.0 code with AGPL-3.0 code, so the combined work is distributed under GPL-3.0-only
with the AGPL-3.0 terms applying to the libsignal parts. Both frontends ship in one build and one origin, so the
build as a whole is offered under those terms; the source of every part is this repository.

## Third-party code in the build

Checked against GPL-3.0-only (the build's license):

- `src/vendor`: `solid`, `tlottie`, `opus`, `StackBlur.js`,
  `fastBlur.js`, `bezierEasing.ts`, `cleanHTML.js`, `createListTransition.ts`, `dateFormat.ts`, `simple-yenc.js` are
  MIT; `recorder.min.js` is ISC; the `opus-recorder` workers in `public/` are MIT, with libopus and the Speex
  resampler (BSD-3-Clause) inside; `prism.ts` is Apache-2.0; `rnnoise` is BSD-3-Clause; `libwebp-0.2.0.js` is under
  the WebM BSD-style license. `leemon.ts`, `convertPunycode.js` and `smoothscroll*` name their authors but no license.
- `src/vendor/telegram-3d-star` (GPL-2.0-only, which GPL-3.0 code cannot include) is removed: the stars of Telegram
  Premium and Stars keep an empty box (`src/components/star3D`).
- npm packages that the bundle includes are MIT, ISC, Apache-2.0, BSD, 0BSD or Unlicense, except `mediabunny`
  (MPL-2.0, compatible through its secondary-license terms) and `@cryptography/*` (GPL-3.0-or-later).

## Vendored files

Every file tracked at the commit above, except:

- the deployed build in `public/` (hashed `*.js`, `*.css`, `*.map`, `*.wasm`, `*.png`, `*.html`, `changelogs/`,
  `version`); `public/assets`, `site.webmanifest`, `site_apple.webmanifest`, `browserconfig.xml` and the
  `opus-recorder` workers (`decoderWorker`, `encoderWorker`, `waveWorker`) with their WebAssembly files are vendored;
- `public/assets/img/emoji` (Apple emoji images), which the build copies from `emoji-data-ios` instead, as Web A does;
- the Playwright suites and their configs (`e2e/`, `playwright.*.ts`, `vite.*e2e*.config.ts`, `vite.preview.config.ts`,
  `snapshot-server/`), the unit tests (`src/tests/`), the deploy and preview scripts (`build.js`, `git-serve*.js`,
  `ssh.example.json`, `docker-compose.yaml`);
- editor and agent settings (`.agents/`, `.claude/`, `.cursorignore`, `.zed/`, `fff.code-workspace`, `CLAUDE.md`,
  `REVIEW.md`), upstream CI (`.github/`, `.docker/`, `.oss-scanner/`), `.git-blame-ignore-revs`;
- `.env`, which holds Telegram's API id and hash and push server key;
- the `src/opus-recorder` and `src/solid` submodules: the app uses the built copies in `src/vendor`.

## Local changes

The port to Signal changes Web K in place; `git log -- webk` lists the changes after the import commit. In summary:

- Build: `vite.config.ts` serves the app at `/k/` behind the repository's dev server, builds it to `../dist/k`, takes the
  page's policy from `../plugins/csp.ts`, the environment from the repository and the emoji images from `emoji-data-ios`;
  the dev checks of upstream run only with `TWEB_DEV_CHECKS`.
- Telegram API: `src/lib/appManagers/apiManager.ts` no longer uses MTProto; `appSignalManager.ts` answers the managers
  from the shared Signal provider (`src/lib/signal/`). The link screen (`src/pages/cards/SignQRCard.tsx`) shows the
  Signal device link, the account slot needs Web A's `isLinked` marker, peer ids are offset (`builders.ts`).
- Telegram hosts: links of Telegram-only features point to reserved `.invalid` names (the comments keep the original
  hosts); support and bug report links point to Signal and to this project; the web manifests name TeleSignal.
- Threaded workers are copied under query strings instead of `blob:` URLs, which the policy does not allow.
- Frontend switch: the main menu's "Switch to A version" opens `../a/`.
- `src/vendor/telegram-3d-star` is removed (GPL-2.0-only), and `src/components/star3D` draws nothing.
- Telegram's interactive widgets are removed: `src/vendor/widget-sandbox`, `src/vendor/widget-sandbox-quickjs`, their
  runtime (`src/lib/widgetSandbox`, `src/components/widgetSandbox`, `appWidgetsManager`) and build plugin; a widget
  message shows as unsupported media.
- Telegram's TON wallet is removed with `@ton/wallet-engine`: `src/components/wallet`, `src/lib/wallet` and
  `appWalletManager`; its service messages show as unsupported.
- `src/components/popupSandbox/stories/misc.ts`: the two stories that read the unvendored test fixtures are removed.
- Media: a Signal album shows as paid media without a price (`src/lib/signal/media.ts`); the attach menu keeps photos,
  videos and files; media spoilers, round video recording, voice transcription, the GIF tab and the edit that replaces
  a message's media are off; the voice recorder's worklet is a file of the app instead of a `blob:` URL.

## Updating

1. Check out the new tweb commit and copy its tracked files with the exclusions above.
2. Reapply the local changes (`git diff <import commit> -- webk`), update the commit in this file and record any new
   local change above.
