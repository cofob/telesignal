# TeleSignal desktop app

The desktop app wraps the TeleSignal web app in [Tauri 2](https://v2.tauri.app) for macOS, Windows and
Linux. It bundles the web app, so it loads no remote code, and it reaches Signal servers through native
TCP connections instead of the WebSocket tunnel (`proxy/`). The Signal engine and TLS still run in the
page's worker, in WebAssembly.

- Closing the window hides it (Settings, General, Desktop app, "Close to tray", on by default); the engine keeps
  running, and the tray icon or a second launch shows the window again. The tray menu quits the app. The unread
  count appears on the tray icon, the Dock icon (macOS), the taskbar button (Windows) and the launcher icon (Linux
  desktops with the Unity launcher API). Each window reports its own count (`set_notifications_count`), and the app
  shows the sum on the tray icon and on every window's taskbar button, so that windows of different frontends or
  account slots do not replace each other's count; two windows of the same account count it twice.
- New messages show system notifications when the window is not focused and web notifications are on in Settings,
  Notifications; a click opens the chat. See [Desktop integration](#desktop-integration).
- `sgnl://` links open the app and the page handles them like the links in messages (`src/util/signalLinks.ts`):
  `signal.me` (username and phone number), `signal.group` and `joingroup` (group), `addstickers` (sticker pack),
  `signal.tube` (proxy), `signal.link` (call), `linkdevice` and `rereg`. The app forwards only these hosts, so
  another `sgnl://` link, such as the ones Signal Desktop sends between its own windows, does not bring the
  window forward. A link waits in the app until the page takes it with `take_deep_links`: the one that
  launches the app (the command line on Windows and Linux, the open event on macOS), one that arrives while the
  page loads or shows the link screen, and one from a second launch all reach the page, in order, after it is
  ready. At most 8 wait, the oldest dropped first. Signal Desktop registers `sgnl` too, so the system may hand the
  links to it when both are installed. The app handles `tg:` links from its own pages internally and never passes
  them to the system.
- Files that the page downloads are saved by the app, which then offers to open them or show them in the file
  manager; see [Files](#files).
- The updater is off unless a build configures it; see [Releases](#releases).

## Building

Requirements on every system: Rust 1.97 or newer ([rustup](https://rustup.rs)), Node.js and npm as in
`package.json` `engines`, and `npm ci` in the repository root.

```sh
npm run tauri:build                                  # this system's default bundles
npm run tauri:build -- --bundles deb,appimage        # only some bundles
npm run tauri:build -- --target x86_64-apple-darwin  # an Intel build on Apple silicon
```

`tauri:build` runs `npm run build:tauri`, which builds the web app into `tauri/dist`, then compiles the
app and writes the packages to `tauri/target/release/bundle/` (`target/<target>/release/bundle/` with
`--target`).

### macOS

Xcode or its command line tools (`xcode-select --install`). Bundles: `app` and `dmg`. For an Intel build
on Apple silicon, `rustup target add x86_64-apple-darwin` first.

### Windows

Microsoft C++ Build Tools with "Desktop development with C++" and the WebView2 runtime, which Windows 10
and 11 include. Bundle: `nsis`.

### Linux

Bundles: `deb` and `appimage`. Building the AppImage downloads `linuxdeploy` from GitHub.

Debian and Ubuntu (22.04 or newer):

```sh
sudo apt-get install build-essential curl file patchelf \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev
```

Nix (not tested by the maintainers):

```sh
nix-shell -p cargo rustc nodejs pkg-config gobject-introspection \
  webkitgtk_4_1 gtk3 libsoup_3 librsvg libayatana-appindicator openssl glib-networking
```

The app needs `libayatana-appindicator` (or `libappindicator`) at runtime for the tray icon; the `deb`
package depends on WebKitGTK 4.1.

## Development

```sh
npm run tauri:dev
```

This starts `npm run dev` and opens the app on `http://localhost:1234` with hot reload. If the dev server
already runs, skip starting another one:

```sh
npx tauri dev --config '{"build":{"beforeDevCommand":""}}'
```

Rust checks, in `tauri/`: `cargo clippy --all-targets -- -D warnings` and `cargo test`. They need
`tauri/dist` to exist: run `npm run build:tauri` once, or create the empty directory. The tests that
connect to Signal are ignored by default; run them with `cargo test -- --include-ignored`, adding
`UPSTREAM_PROXY=http://host:port` where outbound traffic needs an HTTP proxy.

## Native transport

`src/lib/signal/net/TlsTunnel.ts` runs TLS in WebAssembly over a byte transport: the WebSocket tunnel in
the browser, and in the app the native transport, unless the Proxy server setting (Data and Storage)
names a tunnel. The commands in `src/transport.rs` open the connections:

| Command | Purpose |
| --- | --- |
| `signal_connect(host, trafficClass, onEvent)` | Opens a TCP connection to `host:443` and returns its ID. `trafficClass` is `authenticated` or `unauthenticated`. `onEvent`, a Tauri `Channel`, receives the upstream bytes as `ArrayBuffer`s and then `{ closed: reason }` once |
| `signal_send` | Sends the raw request body (at most 64 KiB) on the connection named by the `signal-connection` header. Resolves once the bytes are queued |
| `signal_ack(id, byteLength)` | Acknowledges received bytes, so the app delivers more |
| `signal_close(id)` | Closes the connection |

The engine opens each connection for one traffic class: `authenticated` for what carries the account's credentials,
`unauthenticated` for sealed sender sends, profile and prekey fetches, group requests and downloads
(`TrafficClass` in `src/lib/signal/config.ts`). The Sealed sender proxy setting names a tunnel for the second class, and
that class then leaves the native transport for a WebSocket tunnel. Without it, the native transport carries both
classes straight to Signal from the same address, unless `UPSTREAM_PROXY` and `SEALED_SENDER_UPSTREAM_PROXY`, two
`http://[user:password@]host:port` HTTP `CONNECT` proxies, give each class its own upstream. `SEALED_SENDER_UPSTREAM_PROXY`
defaults to `UPSTREAM_PROXY`; `proxy/src/lib.rs` (`ClassProxies`) holds that policy.

The engine runs in a web worker, where Tauri's `invoke` and `Channel` do not exist: Tauri injects them
into the page only. The page therefore serves the transport to the worker
(`src/util/tauri/serveNativeTransport.ts`) over a `MessagePort` that it hands to the worker before the
API starts (`src/api/worker/connector.ts`). Buffers move between the threads without copies. The
page runs one `signal_send` at a time per connection, which keeps the order of the bytes; the worker
counts the bytes it posted and not yet sent as `bufferedAmount`, which uploads wait on.

Web K (`/k/`) runs the engine in a SharedWorker for each account slot, which several pages can share. Each page
hands the worker a port of its own as its first message (`webk/src/lib/signal/desktopApp.ts`), and the worker relays
the engine's single port to one of them (`webk/src/lib/signal/nativeTransport.ts`): the first page that offered one,
until it closes. Since the app ends the connections of a page that closes or reloads, the worker then reports every
open connection closed, and the engine reconnects through the next page; without a page, a connection closes at once.
Both frontends call the same commands, so the policy below applies to both.

Buffers are bounded in both directions. A connection queues at most four 64 KiB chunks for the
upstream; `signal_send` waits while the queue is full. The app delivers at most 1 MiB that the worker has
not acknowledged; the worker acknowledges after TLS processed the bytes, in batches of 256 KiB, and the
app stops reading from the server while the window is full.

### Security model

The commands reuse the policy of the WebSocket tunnel from `proxy/src/lib.rs`:

- Hosts: only the allowlist (`ALLOWED_HOSTS`: `chat`, `storage`, `cdn`, `cdn2`, `cdn3`, `cdsi`,
  `contentproxy`, `sfu.voip` and `svr2` `.signal.org`) on port 443.
- Addresses: the app resolves the name once, refuses non-public addresses (loopback, private,
  link-local, CGNAT and other special-purpose ranges) and connects to the address it checked. A
  hostile DNS server therefore cannot point the app at the local network.
- First bytes: a TLS ClientHello whose only server name is the requested host and that has no
  `encrypted_client_hello`, within 10 seconds; otherwise the connection closes. So the commands carry
  only TLS to Signal hosts and cannot serve as a general TCP client.
- TLS ends in the page's WebAssembly, which trusts only Signal's certificate authority. The Rust side
  sees only the server name and encrypted bytes, and never logs payloads.
- Limits: 32 open connections, 120 new connections per minute, 10 seconds to connect, 120 seconds
  idle. A page reload or a closed window ends the connections that page opened.

Only the app's own page can call the commands: the capability in `capabilities/default.json` is
`local`, the app serves its bundled frontend (`tauri://localhost`, `http://tauri.localhost` on
Windows), navigation stays on that page, a window that the page opens with `window.open` is refused, and other
links open in the system browser through `open_external_url`, which takes only `http`, `https`, `mailto` and `tel`
URLs (a `file:` or app-scheme link would run something else). The capability holds the app's own commands and the
event, window, notification, process and updater permissions that the page uses: `process` only for `restart`,
and no `shell`, `fs`, `opener` or `dialog` permissions. The app also sets `app.security.csp` to the production policy of `plugins/csp.ts` (a test keeps them equal), so Tauri sends it as a header with every file, workers included, with `dangerousDisableAssetCspModification` for `style-src` so that Tauri's nonce does not turn off `'unsafe-inline'`. The updater runs only when the build sets an endpoint
and a public key, and it verifies the signature of every update. The CSP (`buildCsp` in `plugins/csp.ts`) allows
`ipc:` and `http://ipc.localhost` for Tauri's IPC.

A tunnel named in the Proxy server setting sees the app's page as the origin `tauri://localhost`
(`http://tauri.localhost` on Windows), so its `ALLOWED_ORIGINS` must list those (`proxy/README.md`).

`UPSTREAM_PROXY=http://[user:password@]host:port` in the app's environment sends the connections
through an HTTP `CONNECT` proxy, as for the tunnel. The proxy then resolves names, so the address check
does not apply.

## Files

The page holds a downloaded attachment as a blob, and system webviews do not download blobs reliably (WKWebView).
The app therefore refuses every download that the webview starts (`on_download` in `src/lib.rs`) and saves files
through the commands in `src/files.rs`. `src/util/tauri/nativeFiles.ts` sends the bytes in 2 MiB chunks as raw
request bodies, one at a time, so a large video builds no JSON array and does not block the page. Web K saves its
downloads the same way (`webk/src/lib/signal/desktopFiles.ts`, from `createDownloadAnchor`); its toast after a save
offers Open and "Show in Finder" (Explorer, Folder), and its log out drops the records too.

| Command | Purpose |
| --- | --- |
| `begin_file_save(fileName, key, shouldAskWhere, dialogTitle)` | Sanitizes the name and creates a hidden temporary file `.<name>.<id>.part` in the destination folder: the system Downloads folder, or the folder of the path that the user picks in the native save dialog when `shouldAskWhere` is set (the "Ask where to save each file" setting, Data and Storage). Returns a save ID, or nothing when the user cancels the dialog |
| `write_file_chunk` | Appends the raw request body to the save named by the `save-id` header |
| `finish_file_save(id)` | Moves the file to its final name (`name (1).ext` when the name is taken, the picked path for the dialog), marks it as downloaded from the Internet (quarantine attribute on macOS, Mark of the Web on Windows), records it under `key` and emits `saved-files-changed` to every window. Returns the final file and folder names for the toast |
| `abort_file_save(id)` | Removes the temporary file. A window that closes or reloads ends its unfinished saves the same way, and the exit of the app ends all of them |
| `list_saved_files` | Returns the keys of the recorded files that still exist and drops the records of the others |
| `open_saved_file(key, langCode)` | Opens a recorded file with the default app, after a confirmation in the language that `langCode` names when its type is dangerous |
| `reveal_saved_file(key)` | Shows a recorded file in Finder, Explorer or the file manager |
| `forget_saved_files` | Drops every record, as logging out does, because they hold paths and attachment keys of the account. The files stay where the user saved them |

The page names a file by a key, the media hash for an attachment, and keeps the keys that `saved-files-changed` and
`list_saved_files` report in tab state, so that the toast after a save, the message context menu and a click on a
document offer Open and "Show in Finder" (Explorer, Folder). A file that was moved or deleted answers `missing`, and
the page says so.

### Security

- A file name never leaves the chosen folder: `sanitize_file_name` removes path separators, control, bidi and
  zero-width characters and the characters that Windows rejects, trims trailing dots and spaces, prefixes the reserved
  Windows device names, and limits the length, keeping the extension. Free names are claimed with `create_new`, so two
  saves never take the same name.
- `open_saved_file` and `reveal_saved_file` take a key, never a path, and act only on records that `finish_file_save`
  made. The records persist in `saved_files.json` in the app data directory (at most 5000, the oldest go first). A
  record whose file is gone, or is a link or a folder now, is dropped.
- A save belongs to the window that began it: `write_file_chunk`, `finish_file_save` and `abort_file_save` answer
  "Unknown save" to any other window, and a page runs its saves one at a time.
- Opening a file of a dangerous type (`DANGEROUS_EXTENSIONS`: Signal Desktop's list from
  `ts/util/isFileDangerous.std.ts` plus the types of macOS, Linux and Windows packages, disk images, scripts and Office
  macros that it lacks; the text after the last dot counts, so `.exe` is dangerous) asks in a native dialog. Rust builds
  the dialog with the real file name and extension, in the page's language: `OPEN_WARNING_TEXTS` holds the words for
  each shipped language (English, Russian), and the page passes only its language code (`langCode` of
  `open_saved_file`), which picks a set, English for an unknown one. The page passes no text for it and cannot skip it.
- The `dialog` and `opener` plugins are registered without permissions for the page; only the commands above are in
  `capabilities/default.json`. Log lines name no saved file, because file names come from messages. The opener's reveal uses Finder on macOS, `SHOpenFolderAndSelectItems` on Windows and the
  `org.freedesktop.FileManager1` D-Bus interface on Linux; when that fails, the app opens the folder with the default
  app (`xdg-open`).

## Desktop integration

Settings, menus and notifications that need the operating system live in Rust, so they work before the page loads
and without the page's permission for plugins.

### Settings

Settings, General, "Desktop app" (only in the app; `SettingsDesktopApp.tsx`) shows the settings that Rust keeps:

| Setting | Stored in | Effect |
| --- | --- | --- |
| Close to tray (default on) | `desktop_settings.json` in the app data directory | On: closing the last window hides it, as the tray icon does; off: closing it quits the app |
| Launch at login | The system's entry (`tauri-plugin-autostart`: `~/.config/autostart` on Linux, a Launch Agent on macOS, the `Run` registry key on Windows) | The entry starts the app with `--autostart`, which opens the window hidden in the tray; a second launch with it does not bring a running window forward |
| Hide content from screenshots (macOS and Windows only) | `desktop_settings.json` | `content_protected` on every window, also on the ones that open later |

`get_desktop_settings` and `set_desktop_settings` (`src/settings.rs`) read and change them; the page keeps no copy.
The window state plugin does not restore whether a window was visible (`StateFlags::VISIBLE` is off), so a hidden
start stays hidden.

### Notifications

The page asks for a notification with `show_notification(title, body, openLabel, chatId?, messageId?)`
(`src/notifications.rs`, `notify-rust`, which the notification plugin already pulls in). The command shows it and waits
for the user on a thread of its own (at most 64 at once; the others are shown without opening their chat, and a warning
says so): the D-Bus `ActionInvoked` signal of the `default` action on Linux, the toast activation on Windows and the
notification center on macOS. A click brings the window forward (`bring_window_forward`) and emits
`notification-clicked` with `{ chatId, messageId }`, which `setupTauriListeners.ts` turns into `focusMessage`. Web K
passes its notification's key with the prefix `webk:` as `chatId` and runs that notification's click action
(`webk/src/lib/signal/desktopApp.ts`); each frontend ignores the clicks of the other's notifications, which reach it
when the window switched frontends since.

On Linux the text is escaped (`&`, `<`, `>`) when the server has `body-markup`, so a sender cannot inject links or
images, and the default action goes only to a server with `actions`; its label is the page's word for "Open". The page
passes no chat while the screen is locked, and the title and body already follow the "message preview" setting, so a
click reveals nothing that the notification did not. The notification plugin remains for the permission check only.

### Menus and shortcuts

- macOS: the menu bar (`src/menu.rs`) has the app menu (Settings, Cmd+,; Hide; Quit), Edit (undo, redo, cut, copy,
  paste, select all) and Window (minimize; Close, Cmd+W, which closes the window like the close button, so it follows
  "Close to tray"). A click on the Dock icon (`RunEvent::Reopen`) shows the window. The page sends the labels with `set_menu_translations`
  when its language changes; the tray menu takes them too.
- Windows and Linux: no menu bar. Ctrl+Q quits through `quit_app`; the shortcut is `quitApp` in the page's
  keyboard shortcut registry.
- macOS keeps the app out of App Nap for as long as it runs (`begin_background_activity`), so that a hidden window
  does not delay the engine's timers and network callbacks.

### Web K

Web K (`/k/`) takes the same integration from `webk/src/lib/signal/desktopApp.ts` and, once its chats show,
`webk/src/lib/signal/desktopIm.ts`: the native transport, notifications, the unread count, links in the system browser,
downloads, the "Desktop app" settings (General) and "Ask where to save each file" (Data and Storage), Ctrl+Q with Web A's
combo, Cmd+, opening its settings, the menu labels, the window title of the open chat (unless Web A's
`canDisplayChatInTitle` is off) and the update check. Web K opens `sgnl:` links itself, in the order they came
(`webk/src/lib/signal/signalLinks.ts`, as Web A's `openSignalLink`): a number is looked up after a confirmation, a group
or a sticker pack opens with its preview, and the next link waits for the answer to the previous one. The window title
follows renames of the open chat. On macOS Web K uses the standard title bar (`mark_title_bar_overlay(false)`); Web A
asks for the overlay again when it starts.

### Connection and theme

- The page asks the engine to reconnect at once (`reconnectNow`, `src/util/setupReconnectTriggers.ts`) on the `online`
  event and when a timer fires 90 s or more after it was due, which is how a sleeping computer looks. This applies to
  the browser build too. Only the master tab asks.
- The page follows `prefers-color-scheme` and needs no help from the app: WebKitGTK 2.52 updates it live when the GTK
  theme changes (tried with XSettings), WKWebView and WebView2 are expected to (not tried), and `tao` reports
  `ThemeChanged` on Linux only for a theme that the app sets itself, so the window's `onThemeChanged` would add
  nothing.

### Context menu and spelling

The webview's context menu is cut off outside development (`setupTauriListeners.ts`), except in text fields, where
the system menu offers cut, copy, paste and the spelling suggestions. The `devtools` feature of `tauri` is off, so a
release build has no inspector item in it; `tauri dev` and debug builds keep it. The composer sets `spellcheck`.
Whether the webview then spell-checks depends on the system: WKWebView and WebView2 follow the user's settings, and
`wry` never switches spell checking on in WebKitGTK.

## Releases

`.github/workflows/desktop.yml` builds the packages for the release workflow (`v*` tags, see
`docs/RELEASING.md`) and on manual runs:

| Runner | Target | Packages |
| --- | --- | --- |
| `macos-latest` | `aarch64-apple-darwin` | `.dmg`, `.app.tar.gz` |
| `macos-latest` | `x86_64-apple-darwin` | `.dmg`, `.app.tar.gz` |
| `windows-latest` | `x86_64-pc-windows-msvc` | NSIS `.exe` |
| `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `.deb`, `.AppImage` |

Each job uploads its packages as a workflow artifact. In a release run they also attach to the draft GitHub
release, which the workflow publishes once every asset exists. The app version comes from `package.json`.

Signing and the updater are off unless these exist in the repository settings:

| Name | Kind | Purpose |
| --- | --- | --- |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Secret | Base64 `.p12` Developer ID Application certificate and its password. Without them, macOS builds are signed ad hoc and Gatekeeper asks users to confirm the first launch |
| `APPLE_SIGNING_IDENTITY` | Secret | The certificate's name, such as `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Secret | Notarization: Apple ID, app-specific password and team ID |
| `SM_HOST`, `SM_API_KEY`, `SM_CLIENT_CERT_FILE_B64`, `SM_CLIENT_CERT_PASSWORD`, `KEYPAIR_ALIAS` | Secret | Windows signing with DigiCert KeyLocker (`smctl`); `SM_API_KEY` turns it on |
| `UPDATER_ENDPOINT` | Variable | URL of the update manifest, such as `https://github.com/<owner>/<repo>/releases/latest/download/latest.json` |
| `UPDATER_PUBLIC_KEY` | Variable | Public key from `npx tauri signer generate` |
| `UPDATER_PRIVATE_KEY`, `UPDATER_PRIVATE_KEY_PASSWORD` | Secret | The matching private key and its password, which sign the update packages |

The updater needs all of `UPDATER_ENDPOINT`, `UPDATER_PUBLIC_KEY` and `UPDATER_PRIVATE_KEY`.
`deploy/prepareTauriConfig.js` turns these into configuration overrides; the app checks for updates only
when the build configures an endpoint, and only there.

## Icons

`icons/source/` holds the SVG sources. To regenerate the PNG, ICO and ICNS files:

```sh
rsvg-convert -w 1024 -h 1024 tauri/icons/source/icon.svg -o /tmp/icon.png
npx tauri icon /tmp/icon.png -o /tmp/icons        # copy the files listed in tauri.conf.json to tauri/icons
rsvg-convert -w 1024 -h 1024 tauri/icons/source/icon-macos.svg -o /tmp/icon-macos.png
npx tauri icon /tmp/icon-macos.png -o /tmp/icons-macos  # to tauri/icons/macos
rsvg-convert -w 32 -h 32 tauri/icons/source/tray-macos.svg -o tauri/icons/tray-macos.png
rsvg-convert -w 540 -h 380 tauri/images/source/background-dmg.svg -o tauri/images/background-dmg.png
```
