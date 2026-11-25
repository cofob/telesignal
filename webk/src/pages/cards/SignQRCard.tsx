import {createSignal, onCleanup, onMount, Show} from 'solid-js';

import Button from '@components/buttonTsx';
import LanguageChangeButton from '@components/languageChangeButton';
import showSignalProxyPopup from '@components/popups/signalProxy';
import {putPreloader} from '@components/putPreloader';
import MediaHeader from '@components/mediaHeader';
import mediaHeaderStyles from '@components/mediaHeader.module.scss';
import {paintQrCode} from '@helpers/qrCode/paintQrCode';
import {LangPackKey, i18n} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {getSignalProxySettings} from '@lib/signal/proxySettings';
import type {SignalLinkCode} from '@appManagers/appSignalManager';
import type {SignalAuthState, SignalHistorySync} from '@lib/signal/registrationTypes';

import {toastNew} from '@components/toast';
import {DEAUTHORIZATION_LANG_KEYS, takeDeauthorizationReason} from '@lib/signal/deauthorization';
import AuthCard from '@/pages/AuthCard';
import SignalHistorySyncCard from '@/pages/cards/SignalHistorySync';
import {CardSpec, useAuthFlow} from '@/pages/authFlow';
import styles from '@/pages/authFlow.module.scss';

if(import.meta.hot) import.meta.hot.accept();

type Spec = Extract<CardSpec, {name: 'signQR'}>;

const QR_SIZE = 240;

/**
 * Card variant of `pageSignQR`: the Signal device link code, painted into the `auth-image` slot; once the
 * phone links this device we go to IM. A new account is registered by its phone number from here (`SignInCard`).
 */
export default function SignQRCard(_props: {spec: Spec}) {
  const {accountNumber, managers} = useAuthFlow();

  // Persistent host for the QR canvas (qr-code-styling injects its canvas
  // into this div). We hand it to <MediaHeader.Sticker element={...}>.
  let stickerHost: HTMLDivElement;
  let preloader: HTMLElement | undefined;
  let stopped = false;

  // Latest token we've drawn — kept so the theme_changed listener can repaint
  // synchronously without waiting for the next `iterate` cycle to come around.
  let lastDrawnToken: string | undefined;
  let QRCodeStylingCtor: any;

  /* ---------- description list ---------- */

  const helpKeys: LangPackKey[] = ['Login.QR.Help1', 'Login.QR.Help2', 'Login.QR.Help3'];
  const helpList = (
    <ol class={styles.qrDescription}>
      {helpKeys.map((key, idx) => (
        <li class={styles.qrDescriptionItem}>
          <span class={styles.qrDescriptionMarker}>{idx + 1}</span>
          {i18n(key)}
        </li>
      ))}
    </ol>
  );

  /* ---------- 'user_auth' subscription ---------- */

  const onUserAuth = () => {
    stopped = true;
  };
  rootScope.addEventListener('user_auth', onUserAuth, {once: true});

  /* ---------- paint QR ---------- */

  // Builds the QR canvas (and its embedded logo) from the current token using the
  // theme's CSS variables. Called on token rotation from `iterate` and on theme
  // change from the `theme_changed` listener so the QR repaints with the new
  // colors without waiting for the next 3-second polling tick.
  async function paintQR(url: string) {
    if(!QRCodeStylingCtor) return;

    const style = window.getComputedStyle(document.documentElement);
    const surfaceColor = style.getPropertyValue('--light-filled-primary-color').trim();
    const textColor = style.getPropertyValue('--primary-text-color').trim();
    const primaryColor = style.getPropertyValue('--primary-color').trim();

    const {canvas} = await paintQrCode({
      data: url,
      size: QR_SIZE,
      host: stickerHost,
      background: surfaceColor,
      foreground: textColor,
      logoColor: primaryColor,
      canvasClass: styles.qrCanvas,
      QRCodeStylingCtor
    });

    // ! costyl, but the library doesn't expose any events
    if(preloader) {
      preloader.style.animation = 'hide-icon .4s forwards';

      canvas.style.display = 'none';
      canvas.style.animation = 'grow-icon .4s forwards';
      setTimeout(() => {
        canvas.style.display = '';
      }, 150);
      setTimeout(() => {
        canvas.style.animation = '';
      }, 500);
      preloader = undefined;
    } else {
      Array.from(stickerHost.children).slice(0, -1).forEach((el) => el.remove());
    }

    lastDrawnToken = url;
  }

  /* ---------- theme_changed: repaint with new CSS-variable colors ---------- */

  const onThemeChanged = () => {
    if(stopped || !lastDrawnToken) return;
    paintQR(lastDrawnToken);
  };
  rootScope.addEventListener('theme_changed', onThemeChanged);

  /* ---------- link code ---------- */

  // * TeleSignal: the code is the Signal engine's device link URL (`sgnl://linkdevice?...`), which the
  // * provisioning socket replaces while it waits (@appManagers/appSignalManager). The engine starts the
  // * account's session once the phone scanned it, and the chats open once the slot holds it (`SignalAuthController`)
  let lastUrl: string | undefined;
  const onLinkCode = (code: SignalLinkCode) => {
    if(stopped || !code || code.url === lastUrl) return;
    lastUrl = code.url;
    paintQR(code.url);
  };

  rootScope.addEventListener('signal_link_code', onLinkCode);

  // * once the phone scanned the code, its message history comes before the chats open: the transfer replaces the code
  const [historySync, setHistorySync] = createSignal<SignalHistorySync>();
  const onAuthState = (state: SignalAuthState) => setHistorySync(state?.historySync);
  rootScope.addEventListener('signal_auth_state', onAuthState);

  // * a device that the server stopped accepting comes back here; the screen says why, as Web A's toast does
  const showDeauthorization = () => {
    const reason = takeDeauthorizationReason();
    if(reason) toastNew({langPackKey: DEAUTHORIZATION_LANG_KEYS[reason]});
  };
  rootScope.addEventListener('signal_deauthorized', showDeauthorization);

  /* ---------- lifecycle ---------- */

  onMount(async() => {
    managers.appStateManager.pushToState('authState', {_: 'authStateSignQr'});
    showDeauthorization();
    managers.appSignalManager.getAuthState().then(onAuthState);

    preloader = putPreloader(stickerHost, true);

    const [{default: QRCodeStyling}] = await Promise.all([
      import('qr-code-styling' as any)
    ]);

    if(stopped) return;
    QRCodeStylingCtor = QRCodeStyling;
    onLinkCode(await managers.appSignalManager.getLinkCode());
  });

  onCleanup(() => {
    stopped = true;
    rootScope.removeEventListener('user_auth', onUserAuth);
    rootScope.removeEventListener('theme_changed', onThemeChanged);
    rootScope.removeEventListener('signal_link_code', onLinkCode);
    rootScope.removeEventListener('signal_auth_state', onAuthState);
    rootScope.removeEventListener('signal_deauthorized', showDeauthorization);
  });

  /* ---------- render ---------- */

  // * the code stays in the page while the history comes, so that a transfer that asks for a new link shows it again
  const qrCard = (
    <AuthCard
      class={styles.pageSignQR}
      inputWrapper={false}
      header={
        <MediaHeader>
          <MediaHeader.Sticker ref={stickerHost} class={styles.qrContainer} size={QR_SIZE}/>
          <h1
            class={`${mediaHeaderStyles.title} text-center text-overflow-wrap`}
            style={{'margin-top': 0}}
          >
            {i18n('Login.QR.Title')}
          </h1>
        </MediaHeader>
      }
    >
      {helpList}
      {/* the engine leaves the link code for the number's entry, as Web A's link screen does */}
      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        onClick={() => managers.appSignalManager.callSignal('restartAuth')}
      >
        {i18n('SignalRegisterLink')}
      </Button>
      {/* a tunnel that is blocked shows no code: the proxy server is set here, as on Web A's link screen */}
      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        onClick={async() => showSignalProxyPopup('signalProxyUrl', (await getSignalProxySettings()).signalProxyUrl)}
      >
        {i18n('SignalProxySettings')}
      </Button>
      {accountNumber === 1 && <LanguageChangeButton />}
    </AuthCard>
  );

  return (
    <Show when={historySync()} fallback={qrCard}>
      {(sync) => <SignalHistorySyncCard historySync={sync()} />}
    </Show>
  );
}
