# Changelog

All notable changes to TeleSignal are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).
How to add entries and cut a release: [docs/RELEASING.md](docs/RELEASING.md). The history of Telegram Web A, on which
TeleSignal is based, is in [docs/TELEGRAM_WEB_A_CHANGELOG.md](docs/TELEGRAM_WEB_A_CHANGELOG.md).

## [Unreleased]

Web K catches up with Web A and runs in the desktop app, its Telegram features are gone, and pinned messages and
shared media work in both frontends.

### Added

- Web K (`/k/`) does what Web A does; `/` still opens `/a/`. Messages: photos, albums, videos, GIFs, voice messages
  (recording too), music, files, stickers, link previews and contact cards, with a media viewer and the profile's
  shared media tabs; polls (create, vote, retract, close); view-once media; pinned messages; message details with the
  status of each recipient; mentions with an unread mentions button; reactions with any emoji; "Resend" and "Send
  anyway" after a safety number change; automatic text replacements; Music, Date and Article in the attach menu;
  Download and Copy Image in the message menu; the call log.
- Web K: Signal stories (the ribbon, photo, video and text stories, replies, reactions, the viewers of your own
  stories, New Story to My Story, custom lists and groups, and the stories settings). Groups: joining a group that
  invited you, Pending Invites, adding a member by phone number, End Group, the removed members with unban for admins,
  the admin badge, the name of the admin who deleted a message, Signal's group link screen and the message request
  bar with Accept, Delete, Block and Report spam.
- Web K: registration with a phone number, Signal secure backups and the recovery key, the key transparency check,
  notification profiles and notifications of pinned messages, several accounts, the proxy servers of Web A, turning
  the passcode on, changing and turning it off with auto-lock, and the progress of the message history transfer on
  the link screen. When the phone unlinks the device, Web K logs out and says why, as Web A does.
- Web K: the Keyboard Shortcuts screen of Web A, with recording, conflict checks, reset and search.
- Desktop app: Web K runs in the app over the native connection, with system notifications, the unread count in the
  tray, downloads with Open and Show in Folder, "Ask where to save each file", Close to tray and Launch at login,
  Ctrl+Q, Cmd+, for the settings, the open chat in the window title, updates, and `sgnl:` links. "Switch to K
  version" is in Web A's menu of the app again.
- Pinned messages in both frontends: pin and unpin for everyone, with a "pinned a message" notice in the chat. A chat
  keeps its three newest pins, and pins disappear when they expire. In groups, members who may edit the group pin.
- Shared media in both frontends: the profile tabs list a chat's media, files, links, music and voice messages, and
  Web A shows them for users too. View-once media and GIFs stay out of the media tab.

### Changed

- Web K looks like Web A: Signal's colours, bubbles, avatars and names in the Signal colour of each chat, the main
  menu with My Profile in Web A's order, and the chat and profile menus of Web A.
- Keyboard shortcuts, the send key and automatic text replacements are shared settings of Web A and Web K, and a
  shortcut or send key change in one frontend reaches the open tabs of the other.
- Forwarding takes up to 30 selected messages to up to 5 chats, as in Signal Desktop, in both frontends.
- Web A's pin dialog has no option to pin only for yourself, which Signal does not have.
- The chat search finds a phone number however it is typed, for example `+1 555 010 0001` or `(555) 010-0001`.

### Removed

- Telegram features of Web K: the MTProto connection, Stars, gifts, Premium, payments, bots and Mini Apps,
  communities, forums, business features, boosts and statistics, the TON wallet, interactive widgets, Telegram's
  privacy screens and story features that Signal does not have, and the Speakers and Camera and Quick Reaction
  settings. Web K's worker is about a quarter smaller.

### Fixed

- The media viewer steps to newer photos and videos as well as older ones, and Web K's viewer goes through all of a
  chat's photos and videos instead of only those of the open album.
- Message search keeps reading past long stretches without matches instead of returning an empty page, a new query
  stops the search of the previous one, and Web A's chat search no longer stays loading when its result is dropped.
- Web A's unread badge no longer counts notices such as pins, group changes and timers, and it counts unsupported
  messages.
- "Switch to K version" keeps the open account.
- A Web A tab that Web K made inactive no longer writes its state, so it cannot bring back data that Web K removed.

### Security

- Web K asks before looking up a phone number from a link, and linking a device from a link shows the link and warns
  that the device gets full access to the account.
- Web K runs only Signal links, masked link warnings, hashtags and timestamps from message content; Telegram links and
  bot commands say they are not supported.
- View-once media is erased after viewing, also when it is opened on another device, and sent view-once media is not
  kept. It is marked viewed before it shows, and Web K keeps it out of its file caches.
- Web K sends story view receipts only for the stories that were shown, not for every unviewed story before them.
- Logging out of Web K waits at most three seconds for the server, then erases the account's data, Web A's cached
  state of it and, with a passcode, its copies in the vault.
- Web K no longer subscribes the browser to a push service (Telegram's sender id in Chrome) and removes an earlier
  subscription; the "Show offline notifications" switch is gone.

## [0.2.0] - 2026-11-22

A second frontend based on Telegram Web K, encryption of local data with the passcode, and Signal secure backups.

### Added

- Find a Signal user by username: typing a username such as `alice.42` in the chat search or the contact list offers
  a "Find by username" row, which asks the server only when you click it.
- Local data is encrypted when a passcode is set: keys, messages, conversations, stories, calls and cached attachments
  in every account of the browser. Turning the passcode off decrypts them first. If the data cannot be opened, the app
  asks before erasing anything.
- Signal secure backups in the format of the phone apps, with forward secrecy through SVR-B: back up daily or on
  demand, restore during registration with the recovery key, and save or open a backup file. Turned off by default
  (`SIGNAL_BACKUPS=1` at build time) until it is checked against the live service; a linked device can only read.

### Changed

- The web app serves two frontends of the same account: the current one moves to `/a/`, and a second one based on
  Telegram Web K is at `/k/` (in progress: the link screen, text chats and groups, reactions, quoted replies and
  forwards, message search, the main settings, linked devices, profile, username, privacy and the passcode lock).
  `/` opens `/a/`, keeping the account slot in the address. The main menu of each switches to the other, which opens
  the same chats without linking again; only one runs the connection at a time. Installed web apps and bookmarks of `/` keep working.
- Telegram's branding is replaced with TeleSignal's: the favicon, app and home screen icons, link preview image, page
  and install names, descriptions, notification sound, no-JavaScript and unsupported browser pages, the logo of the
  sign-up screens, the paper plane of the send button, and the duck, monkey and wallet animations and pictures. Texts
  that named Telegram name TeleSignal or Signal.

### Fixed

- Container image: the shipped scripts no longer point browser developer tools to source maps that the image does
  not contain.

### Security

- Desktop app: the app's Content-Security-Policy applies to every file it serves, the engine's worker included.

## [0.1.0] - 2026-11-21

The conversion of Telegram Web A into a Signal client; the plan and its status are in
[docs/signal/PLAN.md](docs/signal/PLAN.md).

### Added

- Signal engine that runs in the browser: libsignal compiled to WebAssembly, a TLS client that trusts only Signal's
  certificate authority, HTTP/2 and WebSocket resources, prekeys, envelope decryption and an IndexedDB store. Linking as
  a secondary device with message history transfer, or registration of a new account with a phone number, captcha,
  Signal PIN and registration lock.
- Messaging: sealed sender, sender keys with group send endorsements, receipts, typing indicators, edits, reactions,
  deletes, polls, retry requests, message requests and blocking, view-once media, voice messages, stickers, attachments,
  long messages, disappearing messages with a default timer, and Note to Self. Links in messages are clickable and ask
  before opening a website.
- Reliable sending: messages that could not be sent after a reload or a lost connection are sent again for up to a day;
  receipts that arrive before the message are kept; a partially sent message is marked, and "Message details" shows the
  status and the reason for each recipient, with "Resend" for those who did not get it.
- Groups v2: create, change and join groups, admins and permissions, member labels, invitations by phone number and
  pending invites, ending a group, invite links, and group changes as service messages.
- Stories: viewing, replies and reactions, sending to My Story, custom lists and groups, view receipts, story settings.
- Synchronization with the primary device: contacts, the storage service (read and write), read and viewed state,
  `deleteForMe`, our profile, username and phone number privacy, privacy settings (read receipts, typing indicators,
  link previews, sealed sender indicators), notification profiles, call history, sticker packs and missing attachments
  requested from the phone.
- Linking other devices to this one when it is the primary device, and a list of linked devices.
- Safety numbers and automatic key verification through Signal's key transparency log.
- Signal links open in the app: `signal.me`, `signal.group`, `signal.art` sticker packs, `signal.tube` proxies,
  `signal.link` calls and `sgnl://` links.
- Call history, gift badge and payment notices, and chat colors from the phone (display only; calls are not
  supported).
- Several accounts in one browser, each with its own data.
- `telesignal-tunnel` (`proxy/`): a Rust WebSocket-to-TCP tunnel with a host allowlist, ClientHello and server name
  checks, per-client limits and bans. The Proxy server setting selects a tunnel at runtime, and a separate Sealed sender
  tunnel setting sends traffic without account credentials through another tunnel.
- Container image `ghcr.io/<owner>/telesignal` for `linux/amd64` and `linux/arm64` with the web app, nginx and the
  tunnel in one container: correct caching and file types, precompressed files, security headers (the app's
  Content-Security-Policy, `frame-ancestors`, `Referrer-Policy`, optional HSTS), `/tunnel` on the app's origin,
  configuration through environment variables or your own nginx config, a non-root user and a read-only root file
  system. Deployment guide in [docs/DEPLOY.md](docs/DEPLOY.md).
- Desktop app (`tauri/`) for macOS, Windows and Linux: native Signal connections, files saved to Downloads or a chosen
  folder with "Open" and "Show in folder", a warning before opening dangerous file types, notifications that open their
  chat, close to tray, launch at login, hiding window content from screenshots (macOS, Windows), a macOS menu bar,
  quick reconnection after sleep, the system context menu in text fields, and `sgnl://` links.
- Signal theme, now the default, and Signal avatar colors. UI settings are kept between sessions.
- Continuous integration and releases on GitHub Actions: checks on every push, release assets on `v*` tags (web bundle,
  tunnel binaries and container images, desktop packages, `SHA256SUMS`), Dependabot, and this changelog with its
  tooling.

### Changed

- The app and the page title are named TeleSignal; Saved Messages is Note to Self.
- When the device is unlinked or the account is registered elsewhere, the app removes this device's data and shows the
  link screen.

### Removed

- The Telegram API client (GramJS) and every Telegram-only feature: Stars, gifts, paid content, Premium, ads, business
  features, message effects, bots, mini apps and widgets, channels, forums and topics, Telegram calls, saved dialogs,
  comments, reports, saved reaction tags, translation, remote language packs and the test server.
- Telegram push registration, web login handoff, version switches and links to Telegram hosts; `npm run check:hosts`
  fails on Telegram host names in the shipped app.

### Security

- Content Security Policy allows only the app origin and the Signal tunnel, in the web app and the desktop app.
- Logging out removes all local data of the account even right after a reload, and a linked device unlinks itself on
  the server.
- Error logs mask account ids, phone numbers and keys.
- Desktop app: no shell access for the page, external links limited to web, mail and phone links, new windows blocked,
  and the TLS libraries and the updater's ZIP reader updated to versions that fix published advisories.

[Unreleased]: https://github.com/cofob/telesignal/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/cofob/telesignal/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/cofob/telesignal/releases/tag/v0.1.0
