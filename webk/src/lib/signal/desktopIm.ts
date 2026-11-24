/*
 * TeleSignal: what Web K's main screen adds in the desktop app, as Web A's main screen does (`src/components/main`,
 * `src/hooks/tauri/useDesktopApp.ts`): the window title of the open chat, the labels of the tray and macOS menus, the
 * `sgnl:` links that reached the app, and its updates. Loaded once the account's chats are shown.
 */

import type {Update} from '@tauri-apps/plugin-updater';
import type Chat from '@components/chat/chat';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import I18n, {LangPackKey} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import getPeerTitle from '@components/wrappers/getPeerTitle';
import confirmationPopup from '@components/confirmationPopup';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import {readWebASharedSettings, WebASharedSettings} from '@lib/signal/webAState';
import noop from '@helpers/noop';

// * a link that reached the app while this page shows (`tauri/src/deeplink.rs`)
const DEEP_LINK_EVENT = 'deeplink';
// * Web A's interval of `LeftMain`
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
// * the app's name in the window title outside a chat and in the menus, as Web A names it in the app (`APP_NAME`)
const APP_NAME = 'TeleSignal';

let titlePeerId: PeerId;

export function startDesktopIm() {
  trackWindowTitle();
  sendMenuTranslations();
  rootScope.addEventListener('language_change', sendMenuTranslations);

  takeDeepLinks();
  listen(DEEP_LINK_EVENT, takeDeepLinks).catch(noop);
}

/** The open chat's name, unless Web A's "Show chat name in title" setting is off; the app's name outside a chat */
function trackWindowTitle() {
  const update = async(peerId: PeerId) => {
    titlePeerId = peerId;
    const {canDisplayChatInTitle} = await readWebASharedSettings().catch((): WebASharedSettings => ({}));
    const title = peerId && canDisplayChatInTitle !== false ?
      await getPeerTitle({peerId, plainText: true}) :
      APP_NAME;
    if(titlePeerId !== peerId) return;
    invoke<void>('set_window_title', {title}).catch(noop);
  };

  hotReloadGuard.appImManager.addEventListener('peer_changed', (chat: Chat) => update(chat.peerId));
  update(hotReloadGuard.appImManager.chat?.peerId);
}

/** The labels of the menus that the app builds (`tauri/src/menu.rs`, `tauri/src/tray`), as Web A's `sendMenuTranslations` */
function sendMenuTranslations() {
  const format = (key: LangPackKey, args?: string[]) => I18n.format(key, true, args);
  const translations = {
    'open': format('Signal.Desktop.MenuOpen', [APP_NAME]),
    'quit': format('Signal.Desktop.MenuQuit', [APP_NAME]),
    'quit-app': format('Signal.Desktop.MenuQuit', [APP_NAME]),
    'hide': format('Signal.Desktop.MenuHide', [APP_NAME]),
    'open-settings': format('Settings'),
    'hide-window': format('Close'),
    'edit': format('Edit'),
    'undo': format('Signal.Desktop.MenuUndo'),
    'redo': format('Signal.Desktop.MenuRedo'),
    'cut': format('Signal.Desktop.MenuCut'),
    'copy': format('Copy'),
    'paste': format('Signal.Desktop.MenuPaste'),
    'select-all': format('Signal.Desktop.MenuSelectAll'),
    'window': format('Signal.Desktop.MenuWindow'),
    'minimize': format('Signal.Desktop.MenuMinimize')
  };
  invoke<void>('set_menu_translations', {translations}).catch(noop);
}

/**
 * The `sgnl:` links that launched the app or reached it since. Web A opens Signal links (`openSignalLink` in
 * `src/util/deeplink.ts`) and takes one from its address (`tgaddr`), so a link moves the window to the A version once
 * the user agrees.
 */
async function takeDeepLinks() {
  const urls = await invoke<string[]>('take_deep_links').catch((): string[] => []);
  if(!urls.length) return;

  try {
    await confirmationPopup({
      titleLangKey: 'Signal.Desktop.LinkTitle',
      descriptionLangKey: 'Signal.Desktop.LinkText',
      button: {langKey: 'Signal.Desktop.LinkConfirm'}
    });
  } catch(err) {
    return;
  }

  // * Web A opens one link from its address, the newest that the app passed here
  location.href = new URL('../a/#?tgaddr=' + encodeURIComponent(urls[urls.length - 1]), location.href).href;
}

/**
 * Looks for an update when the build configures the updater (`deploy/prepareTauriConfig.js`), at once and every ten
 * minutes outside development, as Web A's `LeftMain` does; `onUpdate` receives one that is found
 */
export function watchDesktopUpdates(onUpdate: (update: Update) => void) {
  if(!(window as {tauri?: {hasUpdater?: boolean}}).tauri?.hasUpdater) return;

  const check = () => import('@tauri-apps/plugin-updater').then(({check}) => check()).then((update) => {
    if(update) onUpdate(update);
  }, (err) => {
    console.error('Update check failed:', err);
  });

  check();
  if(!import.meta.env.DEV) setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

/** Downloads and installs an update, then starts the app again */
export async function installDesktopUpdate(update: Update) {
  await update.downloadAndInstall();
  const {relaunch} = await import('@tauri-apps/plugin-process');
  await relaunch();
}
