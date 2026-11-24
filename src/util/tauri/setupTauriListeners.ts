import { getActions } from '../../global';

import { SettingsScreens } from '../../types';

import { DEBUG } from '../../config';
import { IS_MAC_OS, MouseButton } from '../browser/windowEnvironment';
import { isDeepLink } from '../deepLinkParser';
import { getLoggableError } from '../maskSensitiveText';
import { isSgnlLink, parseSignalLink } from '../signalLinks';
import { openExternalUrl } from './desktopApp';

const NOTIFICATION_CLICKED_EVENT = 'notification-clicked';
// Web K's notifications name no chat but a key with this prefix (`webk/src/lib/signal/desktopApp.ts`); a click on one
// reaches this page when the window switched to Web A since
const WEB_K_NOTIFICATION_PREFIX = 'webk:';
const OPEN_SETTINGS_EVENT = 'open-settings';

type NotificationClick = {
  chatId: string;
  messageId?: number;
};

// The inputs that hold text, unlike checkboxes, ranges and buttons
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

let isSetup = false;
export default function setupTauriListeners() {
  if (isSetup) return;
  isSetup = true;

  // Show the system context menu only in text fields (cut, copy, paste, spelling suggestions) in production builds,
  // which have no inspector; elsewhere it holds browser items such as Reload and Back
  if (!DEBUG) {
    document.addEventListener('contextmenu', (event) => {
      if (!getIsEditableTarget(event.target)) event.preventDefault();
    });
  }

  void listenToNativeEvents();

  // Web K leaves a macOS window on the standard title bar; the auth and lock screens expect the overlay before `Main`
  // asks for it
  if (IS_MAC_OS) {
    window.tauri.markTitleBarOverlay(true).catch(() => undefined);
  }

  // Disable Backspace handling as back navigation
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Backspace' || event.code === 'Backspace') {
      const target = event.target as HTMLElement | null;
      const isInputField = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;

      if (!isInputField) {
        event.preventDefault();
      }
    }
  }, true);

  // A window that the page asks for is meant for the browser, even when the address is one of Signal's links
  window.open = (url: string | URL | undefined, target?: string, features?: string) => {
    if (url) openLink(url, true);
    // eslint-disable-next-line no-null/no-null
    return null;
  };

  function handleClick(event: MouseEvent) {
    if (event.defaultPrevented) return;

    const target = event.target as HTMLElement | null;
    const anchor = target?.closest<HTMLAnchorElement>('a[href]');

    if (!anchor) return;

    const isModifiedClick = event.ctrlKey || event.metaKey || event.button === MouseButton.Auxiliary;
    if (anchor.target === '_blank' || isModifiedClick) {
      event.preventDefault();

      const href = anchor.getAttribute('href')!;
      // A click with a modifier asks for the browser, so a Signal link on the web stays there
      openLink(href, isModifiedClick);
    }
  }

  // Run after Teact's delegated handlers so links can require confirmation
  window.addEventListener('click', handleClick);
  window.addEventListener('auxclick', handleClick);
}

function getIsEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type) && !target.readOnly && !target.disabled;
  }
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  return target.isContentEditable;
}

async function listenToNativeEvents() {
  try {
    const { listen } = await import('@tauri-apps/api/event');

    // The app brought the window forward after a click on a notification (`tauri/src/notifications.rs`)
    await listen<NotificationClick>(NOTIFICATION_CLICKED_EVENT, ({ payload: { chatId, messageId } }) => {
      if (chatId.startsWith(WEB_K_NOTIFICATION_PREFIX)) return;
      if (messageId === undefined) {
        getActions().openChat({ id: chatId, shouldReplaceHistory: true });
        return;
      }
      getActions().focusMessage({ chatId, messageId, shouldReplaceHistory: true });
    });

    // Cmd+, in the macOS menu bar
    await listen(OPEN_SETTINGS_EVENT, () => {
      getActions().openSettingsScreen({ screen: SettingsScreens.Main });
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to listen to native events:', getLoggableError(err));
  }
}

async function openLink(url: string | URL, shouldOpenInBrowser?: boolean) {
  // Links that only the app handles stay in it: a `tg:` link would leave for another app, and an `sgnl:` link is
  // the app's own scheme. The addresses of Signal's websites that are routes open in the app too, unless the browser
  // is asked for.
  const href = url.toString();
  if (isDeepLink(href) || isSgnlLink(href) || (!shouldOpenInBrowser && parseSignalLink(href))) {
    getActions().openTelegramLink({ url: href });
    return;
  }

  try {
    const urlObject = url instanceof URL ? url : new URL(url, window.location.href);
    // Only the app itself gets a native window with IPC; other pages on the origin open in the browser
    if (window.location.origin === urlObject.origin && window.location.pathname === urlObject.pathname) {
      await window.tauri.openNewWindow(urlObject.toString());
    } else {
      await openExternalUrl(urlObject.toString());
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to open link:', getLoggableError(e));
  }
}
