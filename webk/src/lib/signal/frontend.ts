/*
 * TeleSignal: the page's side of the two frontends of one origin. Web K runs at `/k/` and Web A at `/a/`; both open
 * the same Signal account from the engine's stores, so switching keeps the account and its chats.
 */

import appNavigationController from '@components/appNavigationController';

// * Web A's `IS_SCREEN_LOCKED_CACHE_KEY` (`src/config.ts`): it is there while Web A has a passcode
const WEB_A_PASSCODE_STATE_KEY = 'tt-is-screen-locked';
const WEB_A_PATH = '../a/';

// * through the navigation controller, which otherwise holds the page's navigations back
export function switchToWebA() {
  appNavigationController.navigateToUrl(getWebAUrl());
}

/** Web A in this page's account slot (`?account=N`), and with its other parameters */
function getWebAUrl() {
  const url = new URL(WEB_A_PATH, location.href);
  url.search = location.search;
  return url.toString();
}

/**
 * Web A keeps the account slots in a vault under its passcode, where this frontend cannot open them yet: with a
 * passcode set, the account is opened in Web A
 */
export function isSignalPasscodeEnabled() {
  try {
    return localStorage.getItem(WEB_A_PASSCODE_STATE_KEY) !== null;
  } catch(err) {
    return false;
  }
}

