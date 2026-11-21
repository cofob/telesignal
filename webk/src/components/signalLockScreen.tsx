import {createSignal, onMount, Show} from 'solid-js';
import {render} from 'solid-js/web';
import I18n, {i18n, LangPackKey} from '@lib/langPack';
import {
  eraseUnreadableSignalData,
  getSignalUnlockTimeout,
  SignalUnlockResult,
  unlockSignalPasscode
} from '@lib/signal/passcode';
import styles from '@components/signalLockScreen.module.scss';

const UNLOCK_RESULT_KEYS: Partial<Record<SignalUnlockResult['status'], LangPackKey>> = {
  wrong: 'Signal.Lock.Wrong',
  failed: 'Signal.Lock.Failed'
};

/**
 * The lock screen of an account whose vault has a passcode, shown before the app starts: the passcode unlocks Web A's
 * vault, and the engine starts with its key once `onUnlocked` runs. A passcode that does not open the data is never
 * erased here: the erase is an explicit button of its own, as Web A's storage dialog has it.
 */
const SignalLockScreen = (props: {onUnlocked: () => void}) => {
  const [passcode, setPasscode] = createSignal('');
  const [errorKey, setErrorKey] = createSignal<LangPackKey>();
  const [timeoutUntil, setTimeoutUntil] = createSignal<number>();
  const [isLoading, setIsLoading] = createSignal(false);
  const [isCorrupted, setIsCorrupted] = createSignal(false);

  const lockForTimeout = (until: number) => {
    setTimeoutUntil(until);
    setErrorKey('Signal.Lock.TooManyAttempts');
    setTimeout(() => setTimeoutUntil(undefined), Math.max(until - Date.now(), 0));
  };

  const onSubmit = async(e: Event) => {
    e.preventDefault();
    const value = passcode();
    if(isLoading() || !value || timeoutUntil()) return;

    setIsLoading(true);
    setErrorKey(undefined);
    const result = await unlockSignalPasscode(value).catch((): SignalUnlockResult => ({status: 'failed'}));
    setIsLoading(false);
    setPasscode('');

    if(result.status === 'unlocked') {
      props.onUnlocked();
      return;
    }

    if(result.status === 'timeout') {
      lockForTimeout(result.timeoutUntil);
      return;
    }

    if(result.status === 'corrupted') {
      setIsCorrupted(true);
      return;
    }

    setErrorKey(UNLOCK_RESULT_KEYS[result.status]);
  };

  // * an earlier page's attempts still count: the input stays locked until the time passes
  onMount(() => {
    getSignalUnlockTimeout().then((until) => {
      if(until) lockForTimeout(until);
    });
  });

  const onErase = () => {
    eraseUnreadableSignalData();
  };

  return (
    <div class={styles.root}>
      <div class={styles.card}>
        <Show
          when={!isCorrupted()}
          fallback={(
            <>
              <h1 class={styles.title}>{i18n('Signal.Lock.DataTitle')}</h1>
              <p class={styles.subtitle}>{i18n('Signal.Lock.DataText')}</p>
              <button class={`${styles.button} ${styles.danger}`} onClick={onErase}>
                {i18n('Signal.Lock.Erase')}
              </button>
            </>
          )}
        >
          <h1 class={styles.title}>{i18n('Signal.Lock.Title')}</h1>
          <p class={styles.subtitle}>{i18n('Signal.Lock.Subtitle')}</p>
          <form class={styles.form} onSubmit={onSubmit}>
            <input
              class={styles.input}
              type="password"
              autocomplete="off"
              autofocus
              placeholder={I18n.format('PasscodeLock.EnterYourPasscode', true)}
              aria-label={I18n.format('PasscodeLock.EnterYourPasscode', true)}
              value={passcode()}
              disabled={!!timeoutUntil() || isLoading()}
              onInput={(e) => setPasscode(e.currentTarget.value)}
            />
            <p class={styles.error}>{errorKey() && i18n(errorKey())}</p>
            <button
              class={styles.button}
              type="submit"
              disabled={!passcode() || !!timeoutUntil() || isLoading()}
            >
              {i18n('Signal.Lock.Unlock')}
            </button>
          </form>
        </Show>
      </div>
    </div>
  );
};

/** Shows the lock screen over the app and resolves once the vault is unlocked */
export function showSignalLockScreen(): Promise<void> {
  return new Promise<void>((resolve) => {
    const container = document.createElement('div');
    document.body.append(container);
    const dispose = render(() => (
      <SignalLockScreen
        onUnlocked={() => {
          dispose();
          container.remove();
          resolve();
        }}
      />
    ), container);
  });
}
