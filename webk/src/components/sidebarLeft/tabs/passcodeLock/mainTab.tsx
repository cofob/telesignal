import {Component, createResource, createSignal, onCleanup, Show} from 'solid-js';
import {keepMe} from '@helpers/keepMe';
import ListenerSetter from '@helpers/listenerSetter';
import {i18n, LangPackKey} from '@lib/langPack';
import {isSignalPasscodeEnabled} from '@lib/signal/frontend';
import {
  clearSignalPasscode,
  getSignalAutolockDuration,
  setSignalAutolockDuration,
  setSignalPasscode
} from '@lib/signal/passcodeSettings';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import SettingsTabLottieAnimation from '@components/settingsTabLottieAnimation';
import ripple from '@components/ripple';
import Section from '@components/section';
import type SliderSuperTab from '@components/sliderTab';
import type {AppPasscodeLockTab} from '@components/solidJsTabs';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import Space from '@components/space';
import InlineSelect from '@components/inlineSelect';
import styles from '@components/sidebarLeft/tabs/passcodeLock/passcodeLock.module.scss';

keepMe(ripple);

type AppPasscodeLockTabType = typeof AppPasscodeLockTab;

const MINUTE_MS = 60 * 1000;
// * Web A's choices (`AUTOLOCK_DURATIONS_MS` of `SettingsPasscodeEnabled`); 0 is never
const AUTOLOCK_MINUTES = [0, 1, 5, 30, 60];
const MINUTES_IN_HOUR = 60;

const getHintParams = (tab: SliderSuperTab, title: LangPackKey) => ({
  appendTo: tab.scrollable.container,
  duration: 2500,
  from: 'bottom',
  textElement: i18n(title),
  icon: 'premium_lock',
  class: styles.hint,
  canCloseOnPeerChange: false
} as const);

/**
 * TeleSignal: the passcode of Web A's vault, which both frontends share (`lib/signal/passcodeSettings`): turned on
 * with a passcode entered twice, then changed, turned off, or locked by itself after a time without activity
 */
const MainTab = () => {
  const {rootScope} = useHotReloadGuard();
  const [isEnabled, setIsEnabled] = createSignal(isSignalPasscodeEnabled());

  const listenerSetter = new ListenerSetter();
  listenerSetter.add(rootScope)('toggle_using_passcode', setIsEnabled);
  onCleanup(() => listenerSetter.removeAll());

  return (
    <Show when={isEnabled()} fallback={<NoPasscodeContent />}>
      <PasscodeSetContent />
    </Show>
  );
};

/** The two steps of a new passcode, entered twice; the second one ends with `onSet`, and a failure there shows on it */
function createNewPasscodeSteps(tab: SliderSuperTab, onSet: (passcode: string) => Promise<void>, firstTitle?: LangPackKey) {
  const [, {AppPasscodeEnterPasswordTab, AppPasscodeLockTab}] = useSuperTab<AppPasscodeLockTabType>();

  const onSecondStep = (firstPasscode: string) => {
    tab.slider.createTab(AppPasscodeEnterPasswordTab).open({
      onSubmit: async(passcode, otherTab) => {
        if(passcode !== firstPasscode) throw new Error('passcodes differ');
        await onSet(passcode);
        passcode = '';
        otherTab.slider.sliceTabsUntilTab(AppPasscodeLockTab, otherTab);
        otherTab.close();
      },
      buttonText: 'PasscodeLock.SetPasscode',
      inputLabel: 'PasscodeLock.ReEnterPasscode',
      errorLabel: 'PasscodeLock.PasscodesDontMatch'
    }, 'PasscodeLock.ReEnterPasscode');
  };

  return () => tab.slider.createTab(AppPasscodeEnterPasswordTab).open({
    onSubmit: (passcode) => {
      onSecondStep(passcode);
      passcode = '';
    },
    buttonText: 'PasscodeLock.Next',
    inputLabel: 'PasscodeLock.EnterAPasscode',
    errorLabel: 'PasscodeLock.PasscodesDontMatch'
  }, firstTitle);
}

const NoPasscodeContent = () => {
  const [tab] = useSuperTab<AppPasscodeLockTabType>();
  const {rootScope, setQuizHint} = useHotReloadGuard();

  const onEnable = createNewPasscodeSteps(tab, async(passcode) => {
    await setSignalPasscode(passcode);
    rootScope.dispatchEvent('toggle_using_passcode', true);
    setQuizHint(getHintParams(tab, 'PasscodeLock.PasscodeHasBeenSet'));
  });

  return (
    <Section caption="PasscodeLock.Notice">
      <SettingsTabLottieAnimation name="UtyanPasscode" />

      <div class={styles.description}>{i18n('PasscodeLock.Description')}</div>

      <Space amount="0.5rem" />

      <div class={styles.padded}>
        <button
          use:ripple
          class="btn-primary btn-color-primary btn-large"
          onClick={onEnable}
        >
          {i18n('PasscodeLock.TurnOn')}
        </button>
      </div>

      <Space amount="1rem" />
    </Section>
  );
};

const PasscodeSetContent: Component = () => {
  const [tab, {AppPrivacyAndSecurityTab}] = useSuperTab<AppPasscodeLockTabType>();
  const {rootScope, setQuizHint, Row, confirmationPopup, toastNew} = useHotReloadGuard();

  const options = AUTOLOCK_MINUTES.map((minutes) => ({
    value: minutes * MINUTE_MS,
    label: () => {
      if(!minutes) return i18n('PasscodeLock.Disabled');
      return minutes < MINUTES_IN_HOUR ?
        i18n('MinutesShort', [minutes]) :
        i18n('Hours', [minutes / MINUTES_IN_HOUR]);
    }
  }));

  const [autoCloseRowEl, setAutoCloseRowEl] = createSignal<HTMLElement>();
  const [isOpen, setIsOpen] = createSignal(false);
  const [autolockDuration, {mutate: mutateAutolockDuration}] = createResource(async() => {
    return (await getSignalAutolockDuration()) || 0;
  });

  const onAutolockChange = async(duration: number) => {
    const previous = autolockDuration();
    mutateAutolockDuration(duration);
    if(!await setSignalAutolockDuration(duration || undefined)) {
      mutateAutolockDuration(previous);
      toastNew({langPackKey: 'Error.AnError'});
    }
  };

  const onPasscodeChange = createNewPasscodeSteps(tab, async(passcode) => {
    const {hadPasskey} = await setSignalPasscode(passcode);
    setQuizHint(getHintParams(tab, 'PasscodeLock.PasscodeHasBeenChanged'));
    if(hadPasskey) toastNew({langPackKey: 'Signal.Passcode.PasskeyRemoved'});
  }, 'PasscodeLock.EnterANewPasscode');

  const onDisable = () => {
    confirmationPopup({
      title: i18n('PasscodeLock.TurnOff.Title'),
      description: i18n('PasscodeLock.TurnOff.Description'),
      button: {
        text: i18n('PasscodeLock.TurnOff'),
        isDanger: true
      }
    })
    .then(async() => {
      const failureKey = await clearSignalPasscode();
      if(failureKey) {
        toastNew({langPackKey: failureKey});
        return;
      }

      rootScope.dispatchEvent('toggle_using_passcode', false);
      const privacyTab = tab.slider.getTab(AppPrivacyAndSecurityTab);
      tab.close();
      if(privacyTab) setQuizHint(getHintParams(privacyTab, 'PasscodeLock.PasscodeHasBeenDisabled'));
    })
    .catch(() => {});
  };

  const caption = (
    <>
      {i18n('PasscodeLock.Description')}
      <Space amount="1rem" />
      {i18n('PasscodeLock.Notice')}
    </>
  );

  return (
    <>
      <Section class={styles.firstSection} caption={caption as any}>
        <SettingsTabLottieAnimation name="UtyanPasscode" />

        <Space amount="1.125rem" />

        <Row clickable={onDisable}>
          <Row.Icon icon="lockoff" />
          <Row.Title>{i18n('PasscodeLock.TurnOff.Title')}</Row.Title>
        </Row>
        <Row clickable={onPasscodeChange}>
          <Row.Icon icon="key_filled" />
          <Row.Title>{i18n('PasscodeLock.ChangePasscode')}</Row.Title>
        </Row>
      </Section>

      <Section>
        <Show when={autolockDuration.state === 'ready'}>
          <Row
            ref={setAutoCloseRowEl}
            class={styles.row}
            clickable={() => setIsOpen(true)}
          >
            <Row.Title>{i18n('PasscodeLock.AutoLock')}</Row.Title>
            <Row.RightContent>
              <InlineSelect
                value={autolockDuration()}
                onClose={() => setIsOpen(false)}
                options={options}
                onChange={onAutolockChange}
                isOpen={isOpen()}
                parent={autoCloseRowEl()}
              />
            </Row.RightContent>
          </Row>
        </Show>
      </Section>
    </>
  );
};

export default MainTab;
