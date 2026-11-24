import {createEffect, createSignal, onCleanup, onMount, Show} from 'solid-js';

import Button from '@components/buttonTsx';
import CountryInputField from '@components/countryInputField';
import LanguageChangeButton from '@components/languageChangeButton';
import MediaHeader from '@components/mediaHeader';
import TelInputField from '@components/telInputField';
import IS_TOUCH_SUPPORTED from '@environment/touchSupport';
import cancelEvent from '@helpers/dom/cancelEvent';
import focusWhenSettled from '@helpers/dom/focusWhenSettled';
import placeCaretAtEnd from '@helpers/dom/placeCaretAtEnd';
import {HelpCountry, HelpCountryCode} from '@layer';
import {i18n} from '@lib/langPack';

import AuthCard from '@/pages/AuthCard';
import AuthCardError from '@/pages/AuthCardError';
import {CardSpec, useAuthFlow} from '@/pages/authFlow';
import styles from '@/pages/authFlow.module.scss';
import {
  clearSignalAuthError,
  formatSignalAuthError,
  setSignalPhoneNumber,
  signalAuthError
} from '@/pages/signalRegistration';

if(import.meta.hot) import.meta.hot.accept();

type Spec = Extract<CardSpec, {name: 'signIn'}>;

const LOGO_SIZE = 160;
const MIN_NUMBER_LENGTH = 7;

/**
 * Card variant of `pageSignIn`: the phone number of a Signal registration, as Web A's `AuthPhoneNumber`. Country
 * picker + tel input → the engine (`provideAuthPhoneNumber`), which goes on to the captcha or the code
 * (`pages/signalRegistration`); the QR button goes back to linking.
 */
export default function SignInCard(_props: {spec: Spec}) {
  const {accountNumber, managers} = useAuthFlow();

  let cancelled = false;

  /* ---------- state ---------- */

  const [submitting, setSubmitting] = createSignal(false);
  const [hasValidInput, setHasValidInput] = createSignal(false);

  /* ---------- inputs ---------- */

  let lastCountrySelected: HelpCountry | undefined;
  let lastCountryCodeSelected: HelpCountryCode | undefined;
  // True while we're mirroring a phone-driven country detection into the country
  // selector. In that case the phone field is the source of truth and must NOT be
  // reset to the bare '+code' (that would wipe a just-typed/pasted national number).
  let overriding = false;

  const countryInputField = new CountryInputField({
    onCountryChange: (country, code) => {
      lastCountrySelected = country;
      lastCountryCodeSelected = code;

      if(!code || overriding) return;

      telInputField.value = telInputField.lastValue = '+' + code.country_code;
      setTimeout(() => {
        telEl.focus();
        placeCaretAtEnd(telEl, true);
      }, 0);
    }
  });

  const telInputField = new TelInputField({
    onInput: (formatted) => {
      const {country, code} = formatted || {};
      const countryName = country ? country.name || country.default_name : '';
      if(countryName !== countryInputField.value && (
        !lastCountrySelected ||
          !country ||
          !code || (
          lastCountrySelected !== country &&
            lastCountryCodeSelected.country_code !== code.country_code
        )
      )) {
        overriding = true;
        countryInputField.override(country, code, countryName);
        overriding = false;
      }

      // * as Web A's `AuthPhoneNumber`: a number of at least seven digits, its country code included
      setHasValidInput(telInputField.value.replace(/\D/g, '').length >= MIN_NUMBER_LENGTH);
      clearSignalAuthError();
    }
  });

  const telEl = telInputField.input;
  telEl.setAttribute('role', 'textbox');
  telEl.setAttribute('aria-multiline', 'false');
  telEl.addEventListener('keypress', (e) => {
    if(hasValidInput() && !submitting() && e.key === 'Enter') {
      return onSubmit();
    }
  });

  /* ---------- submit ---------- */

  function onSubmit(e?: Event) {
    if(e) cancelEvent(e);

    setSubmitting(true);
    clearSignalAuthError();
    setSignalPhoneNumber(telInputField.value);
    // * as Web A's `setAuthPhoneNumber`: the digits only
    managers.appSignalManager.callSignal('provideAuthPhoneNumber', telInputField.value.replace(/\D/g, ''));
  }

  // * a refused number takes the button back
  createEffect(() => {
    if(signalAuthError()) setSubmitting(false);
  });

  /* ---------- nearest country ---------- */

  // * Signal has no location lookup: the engine takes the browser language's likely region (Web A's `fetchNearestCountry`)
  async function selectNearestCountry() {
    const iso2: string = await managers.appSignalManager.callSignal('fetchNearestCountry');
    if(cancelled || !iso2) return;
    if(!countryInputField.value.length && !telInputField.value.length) {
      countryInputField.selectCountryByIso2(iso2);
    }
  }

  /* ---------- lifecycle ---------- */

  let cancelFocus: (() => void) | undefined;
  onMount(() => {
    if(!IS_TOUCH_SUPPORTED) {
      cancelFocus = focusWhenSettled(telEl, () => !cancelled);
    }

    selectNearestCountry();
  });

  onCleanup(() => {
    cancelled = true;
    cancelFocus?.();
  });

  /* ---------- render ---------- */

  return (
    <AuthCard
      header={
        <MediaHeader>
          {/* * the app icon, title and help of Web A's `AuthPhoneNumber` */}
          <MediaHeader.Sticker
            class={styles.logoContainer}
            size={LOGO_SIZE}
            element={<img class={styles.logo} src="assets/img/telesignal-logo.svg" alt="" />}
          />
          <MediaHeader.Title tag="h1">{i18n('SignalRegisterTitle')}</MediaHeader.Title>
          <MediaHeader.Subtitle class="secondary">{i18n('SignalRegisterHelp')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
      inputWrapper={false}
    >
      <div class="input-wrapper">
        {countryInputField.container}
        {/* one grid cell with its error line, so that the line takes no gap of the wrapper while empty */}
        <div class={styles.fieldWithError}>
          {telInputField.container}
          <AuthCardError content={formatSignalAuthError(signalAuthError())} describes={telEl} />
        </div>
        {/* * as Web A's `AuthPhoneNumber`, the button comes once a number is typed */}
        <Show when={hasValidInput()}>
          <Button
            class="btn-primary btn-color-primary"
            disabled={submitting()}
            onClick={onSubmit}
          >
            {submitting() ? (
              <>
                {i18n('PleaseWait')}
                <svg xmlns="http://www.w3.org/2000/svg" class="preloader-circular" viewBox="25 25 50 50">
                  <circle class="preloader-path" cx="50" cy="50" r="20" fill="none" stroke-miterlimit="10"/>
                </svg>
              </>
            ) : i18n('Login.Next')}
          </Button>
        </Show>
        {accountNumber === 1 && <LanguageChangeButton />}
      </div>
      <Button
        class="btn-primary btn-secondary btn-primary-transparent primary"
        disabled={submitting()}
        onClick={() => managers.appSignalManager.callSignal('restartAuthWithQr')}
        text="SignalLinkExisting"
      />
    </AuthCard>
  );
}
