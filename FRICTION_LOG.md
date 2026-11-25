# Friction log

## UI actions still call removed Telegram API methods

`src/api/signal/methods/types.ts` lists the names of Telegram methods that `callApi` accepts but the engine does not implement. Each call resolves to `undefined`, so the code after it is dead; their results are typed `any`, which made some callbacks need explicit parameter types after GramJS was removed (verified with `tsc`). 96 names remain (212 at the start of the dead UI sweep). Some wait for the engine and have a working Signal feature behind them: folders, scheduled-style sends, local search (`searchMessagesInChat`, `searchMessagesGlobal`), drafts, default timer, contacts and profile photo. The rest are Telegram-only and still have UI and actions, which removing the name exposes through `tsc`: ephemeral messages and bots (`sendEphemeralMessage`, `deleteEphemeralMessage`; about 340 mentions of `isEphemeral` and `ephemeralBotId`, message views and forwards counters, `forwardInfo.isChannelPost`), account and privacy screens (`fetchPrivacySettings`, `fetchGlobalPrivacySettings`, `fetchContentSettings`, `fetchAccountTTL`, birthdays, `toggleNoForwards` with `NoForwardsRequest`, profile and saved music), emoji, sticker and GIF server features (custom emoji, status emoji, favorite and saved GIFs, dice, emoji groups), Telegram stories extras (albums, archive, profile pins, story links) and wallpapers and chat themes. Delete each group with its action handlers, payload types, components and cache cleanup, and drop the names with `tsc` as the guide.

## Upstream helper scripts that nothing calls remain in `dev/` and `deploy/`

`dev/createBundleStatsComment.ts` (a pull request comment with bundle sizes, keyed by the removed `stars` and `wallet`
bundles) and `deploy/copy_to_dist.sh` (copies static files into `dist` for Telegram Web A's deployment) are not
referenced by `package.json`, by `.github/workflows/*` or by other code. Verified with a repository-wide search; the
files come from Telegram Web A's pipeline and do not match TeleSignal's CI (`docs/RELEASING.md`). They can be deleted
or, for the bundle size comment, rewritten for the current bundles and wired into `ci.yml`.

## A join request cannot be canceled after the group changed

A user whose join request waits for admin approval keeps the state that `buildRequestedState` in
`src/lib/signal/groups/GroupManager.ts` made from the join response: its revision, no group link password, and no read
access to the group (`GET /v2/groups/` answers 403). Verified against the fake storage service of the groups test
harness: when anyone changes the group after the request, canceling it through `buildLeaveChange` conflicts (409) at
every attempt, since `MessageProcessor.refreshGroup` cannot learn the new revision, and fails with "The group change
conflicted with other changes too many times". Whether the real server behaves the same is not verified. The revision
is available from `fetchGroupJoinInfo`, which needs the group link password that the requested state does not keep.

## The desktop app cannot switch on spell checking in WebKitGTK

The composer sets `spellcheck` (`MessageInput.tsx`) and the system context menu is allowed in text fields
(`setupTauriListeners.ts`), but on Linux the webview decides whether to spell-check, through
`webkit_web_context_set_spell_checking_enabled`, which neither `wry` 0.57 nor the app calls (a search for "spell" in the
`wry` and `tauri` sources finds nothing). Verified under Xvfb with WebKitGTK 2.52: misspelled words in the composer got
no underline and the context menu had no suggestions, though the system may lack dictionaries there. Calling it from
`Webview::with_webview` needs the `webkit2gtk` crate as a direct dependency, which the tree has through `wry` but
`tauri/Cargo.toml` does not list. Whether WKWebView (macOS) and WebView2 (Windows) spell-check the composer is not
tried.

## A launch at login on Linux hides the window even when no tray host runs

`tauri/src/lib.rs` opens the first window hidden for `--autostart` (`SHOULD_START_HIDDEN`), and the tray icon is how a
hidden window comes back. On a Linux desktop without a StatusNotifier host (GNOME without the AppIndicator extension,
for example) nobody can show the window except by launching the app a second time. Verified by reading the code; the
hidden start itself was tried under Xvfb, a missing tray host was not. Detecting the host means asking the session bus
whether `org.kde.StatusNotifierWatcher` has an owner, which needs `zbus` (in the tree through `notify-rust`) as a
direct dependency; the start could then stay visible without one.

## The demo account has no file with a risky name

`seedDemo` (`src/lib/signal/dev/seedDemo.ts`) draws its photos and generates a voice note, a WAV file, `Trail guide.pdf`,
a video and a GIF into the attachment cache; `report.pdf` is marked unavailable. The generated files were not tried in
the desktop app. In the desktop app the Open confirmation for a dangerous type (`.exe`, `.sh`,
...), the document click that opens a saved file and the "moved or deleted" answer for a document cannot be tried
without a linked account. Only photos could be saved and opened in the Xvfb run; the confirmation is covered by unit
tests of `is_file_dangerous` alone, and its native dialog was not shown.

## The app cannot tell whether this device is the primary device of the account

Features that only a primary device has, such as the recovery key (`fetchRecoveryKey` in
`src/api/signal/methods/profile.ts`), cannot be hidden from linked devices: no part of the global state carries the
device kind, and `global.config` and `global.appConfig` are cached and loaded independently of the account. The
Settings > Privacy row "Recovery key" therefore shows on every device and a linked device answers with a notification.
Verified by reading the code: `AccountRecord.deviceId` lives only in `SignalStore`, behind the API layer. A flag that
the API sends with the current user, or an app config field that follows the account, would let the row and its search
entry follow `requires` like `arePasskeysAvailable`.

## Playwright screenshots of a focused input make `stricterdom` report `style` mutations

In development builds `src/lib/fasterdom/stricterdom.ts` logs "Unexpected mutation detected: `style`" for each
attribute change outside the mutation phase. `page.screenshot()` of Playwright hides the caret by default, which sets
`caret-color: transparent !important` in the `style` attribute of the focused element and removes it afterwards, so
every screenshot with a focused `input` adds two such errors (verified on the demo account: 0 errors after load, after
opening a chat and after typing; 2 more after each default screenshot, none with `caret: 'initial'`). The error text
names no element, so these reports look like a component bug. Browser verification scripts should pass
`caret: 'initial'`; `stricterdom` could name the target element and ignore `caret-color`.

## `ListItem` acts on the press, so a control in `rightElement` also opens the row

On pointer devices `ListItem` (`src/components/ui/ListItem.tsx`) runs `onClick` from the `mousedown` of its button
(`handleMouseDown`), not from the click. A `Switcher` or `Button` in `rightElement` therefore triggers the row's own
`onClick` unless the wrapper stops both `mousedown` and `click` (`SettingsNotificationProfiles.tsx` does). Verified in
the demo account by toggling a profile, which opened its editor until `mousedown` was stopped as well. A prop of
`ListItem` for controls that must not open the row, or `Switcher` stopping the press itself, would remove the need for
each caller to find this out.

## The API connector drops `destroy` and `reconnectNow` while the engine is not started

`NO_QUEUE_BEFORE_INIT` in `src/api/worker/connector.ts` makes `callApi` and `callApiLocal` resolve these two calls to `undefined` when the worker is not initialized, which is the case on the lock screen of a passcode and in the first seconds after a load. That suited GramJS, which had nothing at rest in the worker. The Signal engine keeps the account, keys and messages in IndexedDB and the Cache API, so a `destroy` that never arrives leaves them (reproduced in Chrome on the demo account; the logout actions now clear the stores from the page with `clearSignalLocalData()`, see S-01 in `docs/signal/SECURITY.md`). A new method that has to act on the stores without a started engine needs the same page-side route, and nothing in the connector says so; whether `destroy` should start the worker and run, or the stores' clearing should be reachable from the page only, is undecided.

## Backups cannot end DEFLATE blocks with a sync marker, since `fflate` 0.8.3 writes it wrong

`src/lib/signal/backups/backupWriter.ts` ports the gzip of Signal Desktop `toPaddedGzipIterable`, which ends a DEFLATE
block around the account data and recipients and at the offsets of `MessageBackupSizing_FlushInterval` with a zlib sync
flush, then pads by `MessageBackupSizing_PaddingSize` for the largest block. `Gzip.flush(true)` of `fflate` 0.8.3 is
that sync flush, and it writes a corrupt stream: `Deflate.prototype.flush` in `lib/index.cjs` puts `this.s.r >> 3`, the
byte count, in the first byte of the marker where the pending bits of the block belong. Verified in a Node script that
pushes four chunks of text and random bytes with a flush after each: 113 of 200 inputs gunzip with `flush(true)` and all
200 with `flush()`. The writer uses `flush()`, which ends the block at the same uncompressed offset without the byte
aligned marker. Readers do not need the marker, and the padding is computed from the same inputs as libsignal's (the
uncompressed size of the largest block and the compressed length), so the files are valid and sized as the format
asks, but the compressed length differs from a zlib stream by the markers. A fix needs a patch of `fflate` or another
deflate implementation as a direct dependency (`pako` is installed only through other packages); `CompressionStream`
cannot flush by hand.

## The Cache API refuses the desktop app's `tauri://` requests on macOS and Linux

`src/util/cacheApi.ts` builds every cache request from `self.location.origin` (`buildCacheRequest`), which is `tauri://localhost` in the bundled desktop app on macOS and Linux. In the WebKitGTK build, `cache.put(new Request('tauri://localhost/attachment/x'), ...)` rejects with "Request url is not HTTP/HTTPS", while the same call with an `http://` URL succeeds (verified under Xvfb with a scratch build of the app that ran the call from the page). `cacheApi.save` catches the error and returns `false`, so nothing is cached there: attachments, stickers and avatars are fetched from the CDN again on every view, and attachments that the CDN has dropped after its retention period cannot be shown again, while the web app and the Windows build (`http://tauri.localhost`) cache them. It also means `signalDev.seedDemo()` shows no pictures in the desktop app. A fixed `http://` base for the cache keys would likely avoid it; WKWebView on macOS was not tested.

## Five npm dependencies come from GitHub, so every install needs `git` and GitHub access

Web K adds one more: `webk/package.json` takes `@ton/wallet-engine` (the TON wallet, a Telegram-only feature) from a
GitHub release tarball, so `npm run install:webk` needs GitHub access too until the wallet is removed.

`package.json` pins `opus-recorder`, `emoji-data-ios`, `eslint-plugin-react-hooks-static-deps`, `eslint-plugin-tt-multitab`
and `@mytonwallet/stylelint-whole-pixel` as `github:` references (`.npmrc` sets `allow-git=root` for them). Verified with
the container build (`Dockerfile`): `npm ci` fails on a machine without GitHub access or, in a plain `node` Alpine image,
without `git`, and fetching them took most of the two minutes that the install needs. A registry copy or a vendored
tarball would make installs hermetic and let the image build run offline from a registry mirror. The two ESLint and one
Stylelint plugins are needed by checks only, which the image build does not run, but `npm ci` installs them all.

## Web K passes the provider's method arguments untyped

Web K (`webk/`) types the provider's API by hand in `webk/src/lib/signal/signalApi.d.ts`, since its type check cannot
include the provider's sources. `src/api/signal/webkContract.ts` checks that description in `npm run check:ts`: the
method names that Web K calls, the `Api*` objects that Web K reads and the ones it hands over. The arguments of each
call and its result are still `any` on Web K's side (`appSignalManager.call`, `SignalMethodHost.call`,
`callSignalApi`), so a changed parameter of a provider method that Web K calls breaks Web K at run time only.

## Web K's reactions assume catalog stickers that Signal emoji do not have

Web K draws a reaction with the `static_icon`, `center_icon` and `select_animation` documents of the reaction catalog
(`webk/src/components/chat/reaction.ts`, `reactionsMenu.ts`), and the catalog comes from `messages.getAvailableReactions`,
which Signal has no sticker for. Without the documents a reaction bubble fails to render (the message disappears from the
chat), and the quick-reaction lookup and the picker's sticker id throw. The Signal port draws the emoji as text and guards
those lookups (`reaction.ts`, `reactionsMenu.ts`, `appReactionsManager.ts`), so the reaction chips, the picker and the
reactors' popover work, and the strip's More button opens the regular emoji panel instead of the catalog. Each new reaction
feature of Web K meets the same catalog assumption and needs its own guard; Web K's code has no single place where the
emoji-as-text rendering is chosen. The stories port added two more such guards: the reaction on the story viewer's heart
(`renderStoryReaction` in `webk/src/components/stories/viewer.tsx`) and the reaction of a row in the story viewers list
(`processDialogElementForReaction` in `webk/src/components/popups/reactedList.tsx`), which threw on `static_icon`.

## Web K keeps search tabs and dead branches of the channels, apps and posts tabs

The global search of Web K no longer has the channels, apps and posts tabs (`webk/src/components/sidebarLeft/index.ts`),
but their code remains: the `posts` branches of `onChangeTab` and of the back and forward handling in `sidebarLeft/index.ts`,
and the loaders `loadChannels`, `loadApps` and `loadPosts`, their entries in `noSectionTypes` and the `PRELOADED_MEDIA_TYPES`
set in `webk/src/components/appSearchSuper.ts`. Nothing reaches them, so they are dead code that reads as live. Removing them
needs a check of every `mediaTab.type` comparison, which this change did not make.

## Web K's worker adapter cannot import UI components

The Web K managers, including `webk/src/lib/appManagers/appSignalManager.ts`, run in a SharedWorker, not on the page.
Importing `@components/toast` into that file (a static import, to show an error toast) left the page with an empty body
and no error on the page: Solid reported `Unknown error` and the MTProto worker logged `ErrorEvent`. The adapter now
sends the message as a `signal_error` event from `rootScope`, and `appImManager` shows the toast on the page. The
likely cause is that the component reads DOM globals when its module loads, which a worker lacks; this is not
verified. Any new UI call from a manager needs the same event route.

## Telegram-only features remain in Web K's code behind hidden entry points

The TON wallet, the interactive widgets, the empty-column tips, the popup sandbox, channel creation, the channel
direct-messages settings, the sponsored message explainer, business features and chat automation, bots and Mini Apps,
and boosts and statistics are removed. What remains of bots are inline buttons in messages (`keyboardButton.ts`,
`replyMarkupLayout`, URL authorization) and the bot command cache that ephemeral messages read (`appProfileManager`,
`appMessagesManager`).

Stars, gifts, Premium and payments are removed from the UI and from the managers' sending: paid messages, their
repay requests and queue, suggested posts, group message charges, the stars prices of the composer, the forward popup
and the chat picker, paid reactions and their Stars emoji, the channel reactions editor, the public posts search, the
free-messages code of the QR code popup and its `?free=` links, and collectible gift themes in the QR code popup and
the chat themes. `appPaymentsManager`, `appGiftsManager` and `appManagers/utils/gifts` stay in the worker. What still
reads Stars data that Signal never sends: the price of paid media (`sendFile`'s `stars`, `generateOutgoingPaidMedia`
and the paid media bubble, whose look Signal albums borrow) and the attach popup's paid media menu that sets it
(`newMedia.tsx`, `makePaid.tsx`), which only a broadcast channel shows; the texts of Stars, gift and paid-message
service messages (`messageActionTextNewUnsafe.ts`, the refund text in `bubbles.ts`); the `tg://stars_topup` link,
which answers that it is unsupported; and `rootScope`'s `stars_balance` event. Premium remains where it gates
contact: `getRequirementToContact` and `isPremiumRequiredToContact` with the composer's and the empty chat's Premium
notices.

Communities are removed from the UI, the chat list and the managers. What is left are the guards Telegram's type
unions need (`communityFull` and `communityForbidden` checks in `hasRights`, `appProfileManager` and the reactions
and call code) and the places that drop a community they are handed (`appChatsManager.saveApiChat`,
`dialogCommunity` in `dialogsStorage`, `notifyCommunity` updates in `appNotificationsManager`).

Forums: the group forum tab and its topic list are removed, so a forum opens no topic screen. `isForum` checks and
topic thread ids stay in the shared chat, history and dialog code, as do the bot forum and channel direct message
tabs (`forumTab/botforumTab.ts`, `forumTab/monoforumTab.ts`) and the topic editor, which the profile's media tabs
open (`sidebarRight/tabs/sharedMedia.tsx`). About 100 `.invalid` links of these features remain in `src`; the strings
that Signal chats can show point to Signal on the phone instead.

## Web A calls Note to Self «Your Cloud Storage»

Web A's empty Note to Self (`src/components/middle/NoMessages.tsx`, `ConversationCloudStorageInfoTitle` and the four
description strings) keeps Telegram's wording: «Your Cloud Storage» and «Access this chat from any device». Signal keeps
Note to Self on the linked devices, not in a cloud; Web K says «Your notes» and «See them on your linked devices».

## The demo account shows no avatars and no sticker packs

Avatars are downloaded from the CDN on every request (`fetchAvatar` in `src/api/signal/methods/media.ts`), and sticker
packs (installed, featured, a pack opened from a sticker) are read from Signal's CDN, so none of them shows with the
demo account, which never connects. Web K's avatar downloads, its sticker panel, the pack popup and sending a sticker
from a pack were checked only by reading the code.

## Web A offers media spoilers and uploads that Signal does not have

Web A's attachment modal (`src/components/middle/composer/AttachmentModal.tsx`) offers «Hide with spoiler», but the
provider ignores `shouldSendAsSpoiler` and Signal has no media spoilers. Its size check uses Telegram's limit
(`MAX_UPLOAD_SIZE` in `src/limits.ts`, about 2 GB), while Signal accepts 100 MiB (Signal Android
`RemoteConfig.maxAttachmentSizeBytes`), so a larger file uploads until the server answers 413. Web K hides the spoiler
and rejects larger files while they upload (`webk/src/lib/signal/outgoingMedia.ts`).

## Group changes cannot be exercised with the demo account

The Signal group server is not reachable from the demo account, so every group change (title, description, avatar,
members, admins, rights, link, requests, leaving and creating a group) fails inside the provider, which reports
the reason, and Web K shows it once. The adapter calls and the provider calls are checked up to that point, but a
change that succeeds on the server has not been seen in the app. The demo seed also has no group with its link on
and no join request, so Web K's group link screen with a link and its join request bar and list were seen only with
data put in by hand. Testing the success path needs a linked account on a reachable server, which a contributor
cannot use from the demo seed.

## Web K's settings call the provider only through its worker, and a page-side call reads no account

Web K's managers run in its SharedWorker, and so does the Signal engine. A page module that imports the provider
(`import('@signal-app/provider')`) gets a second copy with no started engine: its `fetchFullUser` and `fetchChats`
answer `undefined` for the demo account, while `rootScope.managers.appSignalManager.callSignal(name, ...)` reaches the
engine (`webk/src/lib/signal/settingsApi.ts`). Verified in Chromium: the page-side `fetchFullUser` for the self user
returned `undefined`, and the same call through the manager returned the profile. Some calls look right from the page
without the engine, such as `fetchSignalDevices`, which answers from the stored demo devices, so the mistake shows only
on the screens that read the account. Screens of Web K should use the managers, and a new engine method needs its
manager method first.

## Web K reads the account slot before it has the passcode, and a read writes a placeholder

`AccountController.get` (`webk/src/lib/accounts/accountController.ts`) fills a missing slot with defaults and writes it
back (`fillMissingData` then `update`). While a passcode's vault is locked, the page's session store is not yet in
memory, so such a read writes the placeholder to plain `localStorage`, next to the vault. Verified in Chromium: when
the startup read the slot before the lock screen, the slot held `{}` after unlocking. Web K now shows the lock screen
(`webk/src/index.ts`, before the Telegram lock wait) before any slot read; any new code that reads the slot at startup
has to stay behind that gate, or the placeholder reaches plain storage.

## Web K keeps Telegram's passcode plumbing behind the Signal lock

Web K locks with Web A's vault (`webk/src/lib/signal/passcode.ts`), and Telegram's lock screen is gone, but the rest of
Telegram's passcode stays: the `settings.passcode` state (`webk/src/config/state.ts`), the encrypted storage layer
and its key handoff (`webk/src/lib/encryptedStorageLayer.ts`, `webk/src/lib/passcode/`), the worker's `isLocked`,
`toggleLockOthers` and auto-lock (`webk/src/lib/mainWorker/index.worker.ts`), `DeferredIsUsingPasscode` and the
`PasscodeLock.*` strings. Nothing turns Telegram's passcode on any more, so this code only runs its "off" branches,
but it reads as live and is checked in places such as `AccountController.updateStorageForLegacy`.

## Web K keeps the in-place account switch of Telegram

Each account slot of Web K now runs in a worker of its own, named after the slot (`webk/src/lib/signal/accountSlot.ts`),
because the Signal provider takes its slot from the worker's name; switching accounts reloads the tab, as in Web A
(`webk/src/lib/accounts/switchAccount.ts`). Each worker still creates the managers of all four accounts, and the
switch in place remains: `apiManagerProxy.switchAccount` and `resetAccountMirrors`, the `account_switched` listeners
of about twenty modules, and the `notifyAllAccounts` routing of notifications to tabs of other accounts, which only
work when one worker serves every account. Removing them means checking each listener for work it does at startup too.

## Every Web K page load reports a page error with no message

Each load of `/k/` in Chromium logs a `pageerror` event whose error is a plain object (seen in Playwright on the demo
account). The app keeps working. An `unhandledrejection` listener added before the page loads shows a
`{type: 'SIGNAL_METHOD_UNSUPPORTED'}` rejection from `AppPaymentsManager.loadStarsStatus`, which asks for the Stars
balance that the adapter (`appSignalManager.ts`) does not answer and does not catch the rejection; it goes with the
inert Stars paths. Other Telegram methods that a manager calls without a catch would show the same way.

## Message search reads the stored messages without an index

Signal keeps no search index, so `searchMessagesInChat` and `searchMessagesGlobal` (`src/api/signal/methods/messages.ts`)
decrypt and read the stored messages. A call yields to the worker after each chunk of `SEARCH_CHUNK_SIZE` (1000) records and
goes on until it has a match or has read every record, so a rare query reads the whole history before it answers, and a
query without matches reads all of it on each keystroke past the minimum length. The count of a page counts the earlier
pages through a small cache of recent cursors, so a client that jumps to an offset it did not get from the provider sees a
count of that page alone. Web K's shared media tab counters come from `fetchSharedMediaCounts`, which reads a whole chat once
and keeps the counts until a message of the chat changes. An index of message text and attachment kinds in `MessageDb`,
kept by `MessageProcessor`, would make all three exact and bounded.

Unread messages have no index either: `MessageDb.getUnreadMessages` (`src/lib/signal/db/MessageDb.ts`) decodes every
stored message of the chat and filters on `readAt`, so marking a chat read and Web K's unread mention button
(`fetchUnreadMentions`, called for each step of the button) read the whole chat however few messages are unread.

## Web K keeps Telegram's sign-in cards that nothing opens

Web K's sign-in now links with the QR code or registers a phone number through the Signal engine
(`webk/src/pages/signalRegistration.tsx`), and the number card (`webk/src/pages/cards/SignInCard.tsx`) sends the
number to the engine. Telegram's cards for the code, the cloud password, the sign-up, the e-mail setup and recovery
and the web token import (`AuthCodeCard`, `PasswordCard`, `SignUpCard`, `Email*Card`, `SignImportCard`), the
`continueLogin` and `sentCode` helpers stay in `webk/src/pages/` and `authFlow.tsx`, and
`index.ts` still maps Telegram's auth states to them. No step of the engine leads there, so they are dead code that
reads as live; removing them needs the auth states of `AuthState` in `webk/src/types.d.ts` trimmed with them.


## Read state and the unread divider assume that ids follow dates

Messages are stored, paged and marked read by id (`MessageDb`, `read_inbox_max_id`), while both clients show a day's
messages by date (Web A's `compareRenderedMessages`, Web K's `compareBubbleTimelineKeys` in
`webk/src/components/chat/bubbleTimelineOrder.ts`). A message stored later with an earlier date (a call of the call
history, a transcript synced late, a sender's skewed clock) therefore stands above messages with lower ids. Web K's read
cursor takes the highest id seen and the newest rendered bubble (`webk/src/components/chat/bubbles.ts`, `readPromise`), the
unread divider is the first bubble above the read id (`getFirstUnreadBubble`), and the viewport's bottom is compared by id
(`isScrolledPast`). With an inversion, a message above the divider can be unread, or one below it read; Web A has the same
assumption. Observed with the demo's call 66 in Alice's chat, which is read, so it shows no wrong divider there.

## Web K repeats Web A's resolution and checks of keyboard shortcuts

Both frontends take the registry and the key combos from one place (`src/util/keyboardShortcuts/registry.ts` and
`keyCombos.ts`, which Web K imports through `@signal-app/keyboard-shortcuts` and `@signal-app/key-combos`), but the code
around them is written twice. Web A resolves a shortcut's combos (`buildDefaultCombos`, `getIsDefaultAvailable` and
`getKeyboardShortcutCombos` in `src/util/keyboardShortcuts/index.ts`) and checks a recorded combo
(`src/components/left/settings/keyboardShortcuts/helpers.ts`); Web K has its own copies in
`webk/src/lib/keyboardShortcuts.ts` and `webk/src/lib/keyboardShortcutConflicts.ts`. Web A's modules read the global
state (`getGlobal`), the app environment (`IS_APP`, `IS_TAURI`, `IS_FIREFOX` of `windowEnvironment.ts` and
`globalEnvironment.ts`, which pull in `fasterdom` and Tauri) and the settings search, so Web K cannot import them, and
a change to the environments of the defaults, the reserved combos or the conflict rules must be made in both copies.
The search of the settings screen is shared only in part: the key query (`parseKeyQuery`, `getIsComboWithKeys` in
`keyCombos.ts`) is common, while the word matching of `filterKeyboardShortcuts` and its `splitWords` are copied into
`webk/src/components/sidebarLeft/tabs/keyboardShortcuts.tsx`. Pure versions that take the environment and the settings
as arguments would let both frontends share them.

## A Web K test file sometimes fails to load in a full run

`cd webk && npx vitest run` reported a whole file as failed, with none of its tests run, in 3 of about 10 full runs on
a loaded machine (a dev server and a production build running alongside): `src/lib/calls/e2e/tests/blockchain.test.ts`
once, an unnamed file of the same suite twice. The file passes on its own and in the next full run. The cause is not
known; a load-time timeout of the suite is suspected.
