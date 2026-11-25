/*
 * TeleSignal: Web K's pages in the desktop app (`tauri/`), as Web A's `src/util/tauri` serves its pages: the native
 * transport for the worker's engine, system notifications, the unread count on the tray icon, links in the system
 * browser, downloads that the app saves (`lib/signal/desktopFiles`), the app's own settings and the quit shortcut; the
 * main screen adds the rest (`lib/signal/desktopIm`). The app gives IPC to both frontends' pages
 * (`FRONTEND_PATHS` in `tauri/src/lib.rs`); the commands are in `tauri/src`, and `tauri/README.md` describes them.
 */

import {invoke} from '@tauri-apps/api/core';
import {I18n} from '@lib/langPack';
import DEBUG from '@config/debug';
import {IS_APPLE} from '@environment/userAgent';
import noop from '@helpers/noop';
import serveNativeTransport from '@signal-app/serve-native-transport';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';

/** Tauri's `isTauri()`: the app's pages get the flag before their scripts run */
export const IS_DESKTOP_APP = !!(globalThis as {isTauri?: boolean}).isTauri;

const NOTIFICATION_CLICKED_EVENT = 'notification-clicked';
// * Cmd+, in the macOS menu bar (`tauri/src/menu.rs`)
const OPEN_SETTINGS_EVENT = 'open-settings';
// * the app reports a click with the chat that the notification named; Web K names its key with this prefix, which
// * Web A's pages ignore after the window switched frontends (`src/util/tauri/setupTauriListeners.ts`)
const NOTIFICATION_PREFIX = 'webk:';
// * the app keeps at most 64 notifications waiting for a click (`MAX_WAITING_NOTIFICATIONS`)
const MAX_NOTIFICATION_CLICKS = 64;
// * the inputs that hold text, unlike checkboxes, ranges and buttons
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);
const AUXILIARY_BUTTON = 1;

/** What the app keeps itself (`tauri/src/settings.rs`) */
export type DesktopSettings = {
  shouldCloseToTray: boolean,
  shouldLaunchAtLogin: boolean,
  isContentProtected: boolean
};

/** Only macOS and Windows can hide a window from screenshots */
export const CAN_PROTECT_CONTENT = IS_APPLE || navigator.userAgent.includes('Windows');

type NotificationClick = {
  chatId: string,
  messageId?: number
};

// * what a click on a notification does, by the key that the notification passes to the app as its chat
const notificationClicks = new Map<string, () => void>();

/**
 * Hands the worker a port of the native transport and serves it from this page. The port goes first on the worker's
 * port, so the engine has it before it starts, and the worker picks the page that serves (`lib/signal/nativeTransport`).
 */
export function serveNativeTransportToWorker(sendPort: (port: MessagePort) => void) {
  const {port1, port2} = new MessageChannel();
  sendPort(port2);
  serveNativeTransport(port1);
}

/** Sets the unread count on the tray icon, the Dock icon, the taskbar button or the launcher */
export function setDesktopUnreadCount(amount: number) {
  return invoke<void>('set_notifications_count', {amount, isMuted: false}).catch(noop);
}

/**
 * Shows a system notification. A click brings the window forward and runs `onClick`; the app reports the click with
 * the chat that the page named, which here is the notification's key.
 */
export function showDesktopNotification(key: string, title: string, body: string, onClick: () => void) {
  notificationClicks.delete(key);
  notificationClicks.set(key, onClick);
  if(notificationClicks.size > MAX_NOTIFICATION_CLICKS) {
    notificationClicks.delete(notificationClicks.keys().next().value);
  }

  invoke<void>('show_notification', {title, body, openLabel: I18n.format('Open', true), chatId: NOTIFICATION_PREFIX + key}).catch((err) => {
    console.error('Failed to show a notification', err);
  });
}

export function fetchDesktopSettings() {
  return invoke<DesktopSettings>('get_desktop_settings');
}

export function updateDesktopSettings(patch: Partial<DesktopSettings>) {
  return invoke<DesktopSettings>('set_desktop_settings', {patch});
}

/** Takes the links and the app's events; the page calls it once, before it renders */
export function setupDesktopApp() {
  // * a window on macOS opens with its content under the title bar, which Web A's layout leaves room for and Web K's
  // * does not: the standard title bar comes back (`mark_title_bar_overlay`), and Web A asks for the overlay again
  if(IS_APPLE) {
    invoke<void>('mark_title_bar_overlay', {isOverlay: false}).catch(noop);
  }

  // * the system context menu only in text fields (cut, copy, paste, spelling) outside development: elsewhere it holds
  // * browser items such as Reload and Back
  if(!DEBUG) {
    document.addEventListener('contextmenu', (e) => {
      if(!getIsEditableTarget(e.target)) e.preventDefault();
    });
  }

  // * a window that the page opens is meant for the browser: the app refuses windows (`on_new_window`)
  window.open = (url?: string | URL) => {
    if(url) openLink(url);
    return null;
  };

  // * after Web K's handlers, which cancel the clicks on its internal links and on links that ask first
  window.addEventListener('click', onLinkClick);
  window.addEventListener('auxclick', onLinkClick);

  if(!IS_APPLE) {
    listenToQuitShortcut().catch(noop);
  }

  import('@tauri-apps/api/event').then(({listen}) => Promise.all([
    listen<NotificationClick>(NOTIFICATION_CLICKED_EVENT, ({payload}) => {
      // * Web A's chats, from before the window switched frontends, have no key here
      const key = payload.chatId.slice(NOTIFICATION_PREFIX.length);
      const onClick = payload.chatId.startsWith(NOTIFICATION_PREFIX) ? notificationClicks.get(key) : undefined;
      notificationClicks.delete(key);
      onClick?.();
    }),
    listen(OPEN_SETTINGS_EVENT, () => {
      // * the main screen has the settings; the sign-in screens have none
      const {appSidebarLeft, tabs} = hotReloadGuard;
      appSidebarLeft?.createTab(tabs.AppSettingsTab).open();
    })
  ])).catch((err) => {
    console.error('Failed to listen to the app\'s events', err);
  });
}

/**
 * Ctrl+Q quits on Windows and Linux, where the app has no menu bar, with Web A's combo or its user's change of it
 * (`quitApp`, `lib/keyboardShortcuts`)
 */
async function listenToQuitShortcut() {
  // * loaded later, as the shortcuts read Web A's settings
  const {getIsKeyboardShortcut, listenKeyboardShortcuts} = await import('@lib/keyboardShortcuts');
  listenKeyboardShortcuts();

  document.addEventListener('keydown', (e) => {
    // * Web K passes a key on to the composer as a copy of the event (`focusInput`)
    if(!e.isTrusted || !getIsKeyboardShortcut(e, 'quitApp')) return;

    e.preventDefault();
    invoke<void>('quit_app').catch(noop);
  });
}

function onLinkClick(e: MouseEvent) {
  if(e.defaultPrevented) {
    return;
  }

  const anchor = (e.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a[href]');
  if(!anchor) {
    return;
  }

  const isModifiedClick = e.ctrlKey || e.metaKey || e.button === AUXILIARY_BUTTON;
  if(anchor.target === '_blank' || isModifiedClick) {
    e.preventDefault();
    openLink(anchor.href);
  }
}

function openLink(url: string | URL) {
  const urlObject = new URL(url, location.href);
  // * the app's own origin has no page for the browser, and its pages get no second window
  if(urlObject.origin === location.origin) {
    return;
  }

  // * the app opens only web, mail and phone links and refuses the others
  invoke<void>('open_external_url', {url: urlObject.href}).catch((err) => {
    console.error('Failed to open a link', err);
  });
}

function getIsEditableTarget(target: EventTarget | null) {
  if(target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type) && !target.readOnly && !target.disabled;
  }

  if(target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled;
  }

  return target instanceof HTMLElement && target.isContentEditable;
}
