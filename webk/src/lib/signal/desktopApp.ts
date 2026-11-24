/*
 * TeleSignal: Web K's pages in the desktop app (`tauri/`), as Web A's `src/util/tauri` serves its pages: the native
 * transport for the worker's engine, system notifications, the unread count on the tray icon, links in the system
 * browser and downloads that the app saves (`lib/signal/desktopFiles`). The app gives IPC to both frontends' pages
 * (`FRONTEND_PATHS` in `tauri/src/lib.rs`); the commands are in `tauri/src`, and `tauri/README.md` describes them.
 */

import {invoke} from '@tauri-apps/api/core';
import {I18n} from '@lib/langPack';
import DEBUG from '@config/debug';
import {IS_APPLE} from '@environment/userAgent';
import noop from '@helpers/noop';

/** Tauri's `isTauri()`: the app's pages get the flag before their scripts run */
export const IS_DESKTOP_APP = !!(globalThis as {isTauri?: boolean}).isTauri;
// * the app serves its bundle from `tauri://localhost` or, on Windows, `http://tauri.localhost`, where the system
// * webviews run no service workers
export const IS_DESKTOP_APP_BUNDLE = IS_DESKTOP_APP &&
  (location.protocol === 'tauri:' || location.hostname === 'tauri.localhost');

const NOTIFICATION_CLICKED_EVENT = 'notification-clicked';
// * the app keeps at most 64 notifications waiting for a click (`MAX_WAITING_NOTIFICATIONS`)
const MAX_NOTIFICATION_CLICKS = 64;
// * the inputs that hold text, unlike checkboxes, ranges and buttons
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);
const AUXILIARY_BUTTON = 1;

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
  // * the requests wait on the port until the module has loaded
  import('@signal-app/serve-native-transport').then(({default: serveNativeTransport}) => serveNativeTransport(port1));
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

  invoke<void>('show_notification', {title, body, openLabel: I18n.format('Open', true), chatId: key}).catch((err) => {
    console.error('Failed to show a notification', err);
  });
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

  import('@tauri-apps/api/event').then(({listen}) => {
    return listen<NotificationClick>(NOTIFICATION_CLICKED_EVENT, ({payload}) => {
      const onClick = notificationClicks.get(payload.chatId);
      notificationClicks.delete(payload.chatId);
      onClick?.();
    });
  }).catch((err) => {
    console.error('Failed to listen to the app\'s events', err);
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
