/*
 * TeleSignal: the sign-in steps of the Signal engine on the cards of Web K. The engine leads them: it says which step it
 * is at (`signal_auth_state`) and which one it refused (`signal_auth_error`), and the cards send what the user entered
 * to the same provider methods as Web A's auth screens (`src/components/auth`, `src/api/signal/methods/auth.ts`).
 */

import {createRoot, createSignal, JSX, onCleanup, onMount} from 'solid-js';

import I18n, {FormatterArguments, i18n, LangPackKey} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import type {SignalAuthError, SignalAuthState} from '@lib/signal/registrationTypes';

import {CardSpec, currentCard, useAuthFlow} from '@/pages/authFlow';

const CARD_BY_STATE: Partial<Record<SignalAuthState['state'], CardSpec['name']>> = {
  authorizationStateWaitQrCode: 'signQR',
  authorizationStateWaitPhoneNumber: 'signIn',
  authorizationStateWaitCaptcha: 'signalCaptcha',
  authorizationStateWaitCode: 'signalCode',
  authorizationStateWaitPassword: 'signalPin',
  authorizationStateWaitRegistration: 'signalProfile',
  authorizationStateWaitBackupRestore: 'signalRestore'
};

// * one sign-in at a time is on the screen: what the cards share of it lives as long as the page
const store = createRoot(() => {
  const [authState, setAuthState] = createSignal<SignalAuthState>();
  const [authError, setAuthError] = createSignal<SignalAuthError>();
  // * the number the user entered, which the steps after it show; the engine does not send it back
  const [phoneNumber, setPhoneNumber] = createSignal('');
  return {authState, setAuthState, authError, setAuthError, phoneNumber, setPhoneNumber};
});

export const signalAuthState = store.authState;
export const signalAuthError = store.authError;
export const signalPhoneNumber = store.phoneNumber;
export const setSignalPhoneNumber = store.setPhoneNumber;

export function clearSignalAuthError() {
  store.setAuthError(undefined);
}

/**
 * A refused step in Web K's words: Web A's key, with its variables in their order. A key that Web K's language pack
 * lacks shows as an unexpected error, not as the key itself
 */
export function formatSignalAuthError(error: SignalAuthError | undefined): JSX.Element {
  if(!error) return undefined;
  if(!I18n.strings.has(error.key as LangPackKey)) return i18n('ErrorUnexpected');
  const args = Object.values(error.variables || {}) as FormatterArguments;
  return i18n(error.key as LangPackKey, args);
}

/**
 * Follows the engine from one step to the next while the sign-in screens are up, and goes on to the chats once the
 * account is linked or registered. Rendered once by the host of the cards (`AuthCardsHost`).
 */
export function SignalAuthController() {
  const {managers, navigate, toIm} = useAuthFlow();
  let isDone = false;

  const show = (authState: SignalAuthState | undefined) => {
    if(!authState || isDone) return;
    store.setAuthState(authState);
    // * the engine's number of the registration, for a page that reloaded during it
    if(authState.phoneNumber && !store.phoneNumber()) store.setPhoneNumber(authState.phoneNumber);
    const name = CARD_BY_STATE[authState.state];
    if(name && currentCard()?.name !== name) {
      store.setAuthError(undefined);
      navigate({name} as CardSpec);
    }
  };

  const onError = (error: SignalAuthError) => store.setAuthError(error);
  const onAuthorized = () => {
    if(isDone) return;
    isDone = true;
    toIm();
  };

  rootScope.addEventListener('signal_auth_state', show);
  rootScope.addEventListener('signal_auth_error', onError);
  rootScope.addEventListener('signal_authorized', onAuthorized);

  onMount(async() => {
    // * a registration the engine resumed at its start is at its step already
    show(await managers.appSignalManager.getAuthState());
  });

  onCleanup(() => {
    isDone = true;
    rootScope.removeEventListener('signal_auth_state', show);
    rootScope.removeEventListener('signal_auth_error', onError);
    rootScope.removeEventListener('signal_authorized', onAuthorized);
  });

  return undefined as JSX.Element;
}
