/*
 * TeleSignal: the steps of a registration by phone number after the number (`SignInCard`): the captcha, the code, the
 * PIN of Registration Lock, the profile and the restore of a backup, as Web A's `AuthCaptcha`, `AuthCode`,
 * `AuthPassword`, `AuthRegister` and `AuthBackupRestore` show them. The engine says which step comes next
 * (`pages/signalRegistration`).
 */

import {createSignal, JSX, onCleanup, onMount, Show} from 'solid-js';

import Button from '@components/buttonTsx';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import InputField from '@components/inputField';
import MediaHeader from '@components/mediaHeader';
import Row from '@components/rowTsx';
import safeWindowOpen from '@helpers/dom/safeWindowOpen';
import formatBytes from '@helpers/formatBytes';
import {i18n, LangPackKey} from '@lib/langPack';
import rootScope from '@lib/rootScope';

import AuthCard from '@/pages/AuthCard';
import AuthCardError from '@/pages/AuthCardError';
import type {SignalMethodName} from '@lib/signal/signalApi';
import {useAuthFlow} from '@/pages/authFlow';
import styles from '@/pages/authFlow.module.scss';
import {
  clearSignalAuthError,
  formatSignalAuthError,
  signalAuthError,
  signalAuthState,
  signalPhoneNumber
} from '@/pages/signalRegistration';

if(import.meta.hot) import.meta.hot.accept();

// * Web A's `CAPTCHA_URL`: the user solves the captcha in a tab of its own, and the app makes no request there
const CAPTCHA_URL = 'https://signalcaptchas.org/registration/generate.html';
// * Signal's verification codes have six digits (Web A's `CODE_LENGTH`)
const CODE_LENGTH = 6;
const COUNTDOWN_INTERVAL_MS = 1000;
const SECONDS_IN_MINUTE = 60;
const PERCENT = 100;
const RESTORE_STEP_KEYS: Record<string, LangPackKey> = {
  verifying: 'AuthRestoreStepVerifying',
  downloading: 'AuthRestoreStepDownloading',
  validating: 'AuthRestoreStepValidating',
  importing: 'AuthRestoreStepImporting'
};

/**
 * Sends what a step asks for. The button stays busy until the engine answers with a step (a resent code comes back as
 * the same step) or an error, as Web A's `isLoading`; `submitted` names the method sent while it is out
 */
function useSubmit() {
  const {managers} = useAuthFlow();
  const [submitted, setSubmitted] = createSignal<SignalMethodName>();
  const submit = (name: SignalMethodName, ...args: any[]) => {
    clearSignalAuthError();
    setSubmitted(name);
    managers.appSignalManager.callSignal(name, ...args);
  };

  const onAuthState = () => setSubmitted(undefined);
  rootScope.addEventListener('signal_auth_state', onAuthState);
  onCleanup(() => rootScope.removeEventListener('signal_auth_state', onAuthState));

  const isSubmitting = () => !!submitted() && !signalAuthError();
  return {isSubmitting, submitted: () => isSubmitting() && submitted(), submit};
}

function SubmitButton(props: {text: LangPackKey, isSubmitting: boolean, disabled?: boolean, onClick: () => void}) {
  return (
    <Button
      class="btn-primary btn-color-primary"
      disabled={props.disabled || props.isSubmitting}
      onClick={props.onClick}
    >
      {i18n(props.text)}
      <Show when={props.isSubmitting}>
        <svg xmlns="http://www.w3.org/2000/svg" class="preloader-circular" viewBox="25 25 50 50">
          <circle class="preloader-path" cx="50" cy="50" r="20" fill="none" stroke-miterlimit="10"/>
        </svg>
      </Show>
    </Button>
  );
}

function TextButton(props: {text: JSX.Element, disabled?: boolean, onClick: () => void}) {
  return (
    <Button
      class="btn-primary btn-secondary btn-primary-transparent primary"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.text}
    </Button>
  );
}

/** The number on top, which goes back to its entry, as Web A's "Wrong number?" */
function NumberHeader(props: {subtitle: JSX.Element}) {
  const {managers} = useAuthFlow();
  return (
    <MediaHeader>
      <MediaHeader.Title tag="h1">{signalPhoneNumber()}</MediaHeader.Title>
      <MediaHeader.Subtitle class="secondary">{props.subtitle}</MediaHeader.Subtitle>
      <TextButton
        text={i18n('WrongNumber')}
        onClick={() => managers.appSignalManager.callSignal('restartAuth')}
      />
    </MediaHeader>
  );
}

function createField(label: LangPackKey, onInput?: () => void) {
  const field = new InputField({label, plainText: true, withLinebreaks: false});
  field.input.addEventListener('input', () => {
    clearSignalAuthError();
    onInput?.();
  });
  return field;
}

function FieldWithError(props: {field: InputField}) {
  return (
    <div class={styles.fieldWithError}>
      {props.field.container}
      <AuthCardError content={formatSignalAuthError(signalAuthError())} describes={props.field.input} />
    </div>
  );
}

export function SignalCaptchaCard() {
  const {isSubmitting, submit} = useSubmit();
  const [hasLink, setHasLink] = createSignal(false);
  const field = createField('SignalCaptchaLink', () => setHasLink(!!field.value.trim()));
  const helpKeys: LangPackKey[] = ['SignalCaptchaHelp1', 'SignalCaptchaHelp2', 'SignalCaptchaHelp3'];

  return (
    <AuthCard header={<NumberHeader subtitle={i18n('SignalCaptchaTitle')} />}>
      <ol class={styles.qrDescription}>
        {helpKeys.map((key, index) => (
          <li class={styles.qrDescriptionItem}>
            <span class={styles.qrDescriptionMarker}>{index + 1}</span>
            {i18n(key)}
          </li>
        ))}
      </ol>
      <TextButton text={i18n('SignalCaptchaOpen')} onClick={() => safeWindowOpen(CAPTCHA_URL)} />
      <FieldWithError field={field} />
      <SubmitButton
        text="LoginNext"
        isSubmitting={isSubmitting()}
        disabled={!hasLink()}
        onClick={() => submit('provideAuthCaptcha', field.value.trim())}
      />
    </AuthCard>
  );
}

export function SignalCodeCard() {
  const {isSubmitting, submit} = useSubmit();
  const [now, setNow] = createSignal(Date.now());
  const field = createField('Code', () => {
    const code = field.value.replace(/\D+/g, '').slice(0, CODE_LENGTH);
    if(code !== field.value) field.setValueSilently(code);
    if(code.length === CODE_LENGTH && !isSubmitting()) submit('provideAuthCode', code);
  });
  field.input.setAttribute('inputmode', 'numeric');

  const interval = window.setInterval(() => setNow(Date.now()), COUNTDOWN_INTERVAL_MS);
  onCleanup(() => clearInterval(interval));
  onMount(() => field.input.focus());

  const codeInfo = () => signalAuthState()?.codeInfo;

  const ResendButton = (props: {transport: 'sms' | 'voice', nextAt: number | undefined}) => {
    const secondsLeft = () => Math.ceil((props.nextAt - now()) / COUNTDOWN_INTERVAL_MS);
    const isSms = props.transport === 'sms';
    return (
      <Show when={props.nextAt !== undefined}>
        <TextButton
          disabled={secondsLeft() > 0 || isSubmitting()}
          text={secondsLeft() > 0 ?
            i18n(isSms ? 'SignalCodeResendSmsIn' : 'SignalCodeCallIn', [formatCountdown(secondsLeft())]) :
            i18n(isSms ? 'SignalCodeResendSms' : 'SignalCodeCall')}
          onClick={() => submit('requestAuthCode', props.transport)}
        />
      </Show>
    );
  };

  return (
    <AuthCard
      class={styles.pageAuthCode}
      header={<NumberHeader
        subtitle={i18n(codeInfo()?.transport === 'voice' ? 'SignalCodeSentVoice' : 'SignalCodeSentSms')}
      />}
    >
      <FieldWithError field={field} />
      <ResendButton transport="sms" nextAt={codeInfo()?.nextSmsAt} />
      <ResendButton transport="voice" nextAt={codeInfo()?.nextCallAt} />
    </AuthCard>
  );
}

export function SignalPinCard() {
  const {isSubmitting, submit} = useSubmit();
  const field = createField('SignalPinPlaceholder');
  (field.input as HTMLInputElement).type = 'password';
  onMount(() => field.input.focus());
  const onSubmit = () => field.value && !isSubmitting() && submit('provideAuthPassword', field.value);
  field.input.addEventListener('keydown', (e) => e.key === 'Enter' && onSubmit());

  return (
    <AuthCard
      class={styles.pagePassword}
      header={
        <MediaHeader>
          <MediaHeader.Title tag="h1">{i18n('SignalPinTitle')}</MediaHeader.Title>
          <MediaHeader.Subtitle class="secondary">{i18n('SignalPinDescription')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <FieldWithError field={field} />
      <SubmitButton text="LoginNext" isSubmitting={isSubmitting()} onClick={onSubmit} />
    </AuthCard>
  );
}

export function SignalProfileCard() {
  const {isSubmitting, submit} = useSubmit();
  // * a first name is required, as in Web A's `AuthRegister`
  const [hasFirstName, setHasFirstName] = createSignal(false);
  const firstNameField = createField('FirstName', () => setHasFirstName(!!firstNameField.value.trim()));
  const lastNameField = createField('LastName');
  const [isDiscoverable, setIsDiscoverable] = createSignal(true);

  const onSubmit = () => submit('provideAuthRegistration', {
    firstName: firstNameField.value.trim(),
    lastName: lastNameField.value.trim(),
    isDiscoverableByPhoneNumber: isDiscoverable()
  });

  return (
    <AuthCard
      class={styles.pageSignUp}
      header={
        <MediaHeader>
          <MediaHeader.Title tag="h1">{i18n('YourName')}</MediaHeader.Title>
          <MediaHeader.Subtitle class="secondary">{i18n('SignalProfileDescription')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <FieldWithError field={firstNameField} />
      {lastNameField.container}
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx checked={isDiscoverable()} onChange={setIsDiscoverable} toggle />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('SignalRegisterDiscoverable')}</Row.Title>
      </Row>
      <SubmitButton text="LoginNext" isSubmitting={isSubmitting()} disabled={!hasFirstName()} onClick={onSubmit} />
    </AuthCard>
  );
}

export function SignalRestoreCard() {
  const {submitted, submit} = useSubmit();
  const [hasKey, setHasKey] = createSignal(false);
  const field = createField('AuthRestoreKey', () => setHasKey(!!field.value.trim()));
  const restore = () => signalAuthState()?.backupRestore;
  // * the step of a restore under way, from the moment the key is sent, as Web A shows it: none while the key is asked
  // * for, and again after a refused key
  const step = () => !signalAuthError() && (restore()?.step || (submitted() === 'provideAuthRestore' && 'verifying'));
  const percent = () => `${Math.floor((restore()?.progress ?? 0) * PERCENT)}%`;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.backup,application/octet-stream';
  fileInput.addEventListener('change', async() => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if(file && field.value.trim()) {
      submit('provideAuthRestore', field.value.trim(), new Uint8Array(await file.arrayBuffer()));
    }
  });

  const StepText = () => {
    const found = restore()?.found;
    return (
      <>
        <p class="secondary">{i18n(RESTORE_STEP_KEYS[step() as string], [percent()])}</p>
        <Show when={found}>
          <p class="secondary">
            {i18n('AuthRestoreFound', [
              found.modifiedAt ? new Date(found.modifiedAt).toLocaleString() : '',
              formatBytes(found.size)
            ])}
          </p>
        </Show>
      </>
    );
  };

  return (
    <AuthCard
      header={
        <MediaHeader>
          <MediaHeader.Title tag="h1">{i18n('AuthRestoreTitle')}</MediaHeader.Title>
          <MediaHeader.Subtitle class="secondary">{i18n('AuthRestoreText')}</MediaHeader.Subtitle>
        </MediaHeader>
      }
    >
      <FieldWithError field={field} />
      <Show when={!step()} fallback={<StepText />}>
        <SubmitButton
          text="AuthRestoreButton"
          isSubmitting={false}
          disabled={!hasKey()}
          onClick={() => submit('provideAuthRestore', field.value.trim())}
        />
        <TextButton text={i18n('AuthRestoreFile')} disabled={!hasKey()} onClick={() => fileInput.click()} />
        <TextButton text={i18n('AuthRestoreSkip')} onClick={() => submit('skipAuthRestore')} />
      </Show>
    </AuthCard>
  );
}

// * as Web A's `formatMediaDuration`: minutes and seconds
function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / SECONDS_IN_MINUTE);
  return `${minutes}:${String(seconds % SECONDS_IN_MINUTE).padStart(2, '0')}`;
}
