import {createEffect, createSignal, onCleanup} from 'solid-js';
import {keepMe} from '@helpers/keepMe';
import {i18n} from '@lib/langPack';
import SettingsTabLottieAnimation from '@components/settingsTabLottieAnimation';
import {InputFieldTsx} from '@components/inputFieldTsx';
import PasswordInputField from '@components/passwordInputField';
import ripple from '@components/ripple';
import Section from '@components/section';
import type {AppPasscodeEnterPasswordTab} from '@components/solidJsTabs';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import Space from '@components/space';
import styles from '@components/sidebarLeft/tabs/passcodeLock/passcodeLock.module.scss';

keepMe(ripple);

// * Web A's passcode field takes this many characters at most (`PasswordForm`)
const MAX_PASSCODE_LENGTH = 256;
// * a shorter wait makes the tab's slide-in jerky
const FOCUS_DELAY_MS = 400;

type AppPasscodeEnterPasswordTabClass = typeof AppPasscodeEnterPasswordTab;

/** A step of setting, changing or checking the passcode: one field, whose value goes to the payload's `onSubmit` */
const EnterPasswordTab = () => {
  const [tab] = useSuperTab<AppPasscodeEnterPasswordTabClass>();

  let inputField: PasswordInputField;

  const [value, setValue] = createSignal('');
  const [isError, setIsError] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);

  createEffect(() => {
    value();
    setIsError(false);
  });

  setTimeout(() => {
    inputField.input.focus();
  }, FOCUS_DELAY_MS);

  onCleanup(() => {
    setValue('');
    (inputField.input as HTMLInputElement).value = '';
  });

  const canSubmit = () => value() && value().length <= MAX_PASSCODE_LENGTH && !isSubmitting();

  async function onSubmit(e: Event) {
    e.preventDefault();
    if(!canSubmit()) return;

    setIsSubmitting(true);
    try {
      await tab.payload.onSubmit(value(), tab);
    } catch{
      setIsError(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Section caption="PasscodeLock.Notice">
      <SettingsTabLottieAnimation name="UtyanPasscode" />

      <Space amount="1.125rem" />

      <form action="" autocomplete="off" onSubmit={onSubmit}>
        <div class={styles.padded}>
          <InputFieldTsx
            InputFieldClass={PasswordInputField}
            instanceRef={(ref) => void (inputField = ref)}
            maxLength={MAX_PASSCODE_LENGTH}
            autocomplete="off"
            value={value()}
            errorLabel={isError() ? tab.payload.errorLabel : undefined}
            label={tab.payload.inputLabel}
            onRawInput={setValue}
          />
        </div>

        <Space amount="1rem" />

        <div class={styles.padded}>
          <button
            use:ripple
            type="submit"
            class="btn-primary btn-color-primary btn-large"
            disabled={!canSubmit()}
          >
            {i18n(tab.payload.buttonText)}
          </button>
        </div>
      </form>

      <Space amount="1rem" />
    </Section>
  );
};

export default EnterPasswordTab;
