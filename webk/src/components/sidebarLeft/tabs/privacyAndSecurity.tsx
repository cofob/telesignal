import {Component, createSignal, onMount, Show} from 'solid-js';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import InputField from '@components/inputField';
import Section from '@components/section';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {type AppPrivacyAndSecurityTab} from '@components/solidJsTabs/tabs';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import rootScope from '@lib/rootScope';
import type {LangPackKey} from '@lib/langPack';
import {isSignalPasscodeEnabled, switchToWebA} from '@lib/signal/frontend';
import {findExistingOrCreateCustomOption} from '@components/sidebarLeft/tabs/autoDeleteMessages/options';
import showRecoveryKeyPopup from '@components/popups/recoveryKey';
import {
  checkKeyTransparencySelf,
  fetchContactDiscovery,
  fetchKeyTransparencySelfStatus,
  fetchStorySettings,
  fetchMessageSettings,
  fetchPhoneNumberPrivacy,
  fetchPinSettings,
  removePin,
  SignalMessageSettings,
  SignalPhoneNumberPrivacy,
  SignalKeyTransparencySelfStatus,
  SignalPinSettings,
  SignalStorySettings,
  setContactDiscovery,
  setPin,
  setRegistrationLock,
  updateMessageSettings,
  updatePhoneNumberPrivacy,
  updateStorySettings
} from '@lib/signal/settingsApi';

// * Signal's PIN is at least four characters (Signal Android `PinEditText`)
const PIN_MIN_LENGTH = 4;
// * the result of the check of our own account (Web A's `KEY_TRANSPARENCY_SELF_TEXTS`)
const KEY_TRANSPARENCY_SELF_KEYS: Record<SignalKeyTransparencySelfStatus | 'error', LangPackKey> = {
  idle: 'KeyTransSelfIdle',
  running: 'KeyTransRunning',
  ok: 'KeyTransOk',
  fail: 'KeyTransFail',
  intermittent: 'KeyTransSelfRetry',
  // * a check that gave no result, which the row offers to run again
  error: 'KeyTransError'
};

const PrivacyAndSecurity: Component = () => {
  const [tab] = useSuperTab<typeof AppPrivacyAndSecurityTab>();
  const {Row, i18n, confirmationPopup, toastNew} = useHotReloadGuard();

  const [messageSettings, setMessageSettings] = createSignal<SignalMessageSettings>();
  const [phoneNumberPrivacy, setPhoneNumberPrivacy] = createSignal<SignalPhoneNumberPrivacy>();
  // * the PIN, the registration lock and contact discovery belong to the primary device: they are missing on linked ones
  const [pinSettings, setPinSettings] = createSignal<SignalPinSettings>();
  const [isDiscoveryEnabled, setIsDiscoveryEnabled] = createSignal<boolean>();
  const [isPasscodeOn, setIsPasscodeOn] = createSignal(isSignalPasscodeEnabled());
  // * the disappearing messages timer of new chats, as Web A's `SettingsAutoDeleteMessages`; 0 is off
  const [autoDeletePeriod, setAutoDeletePeriod] = createSignal<number>();
  // * none where Web A shows none: a check that is not available, and an account without stories settings
  const [keyTransparencyStatus, setKeyTransparencyStatus] = createSignal<SignalKeyTransparencySelfStatus | 'error'>();
  const [storySettings, setStorySettings] = createSignal<SignalStorySettings>();

  const loadSettings = async() => {
    const [messages, phone, pin, discovery] = await Promise.all([
      fetchMessageSettings(),
      fetchPhoneNumberPrivacy(),
      fetchPinSettings(),
      fetchContactDiscovery()
    ]);
    setMessageSettings(messages);
    setPhoneNumberPrivacy(phone);
    setPinSettings(pin);
    setIsDiscoveryEnabled(discovery);
  };

  const loadAutoDeletePeriod = async() => {
    setAutoDeletePeriod(await tab.managers.appPrivacyManager.getDefaultAutoDeletePeriod().catch((): undefined => undefined));
  };

  onMount(async() => {
    loadSettings();
    loadAutoDeletePeriod();
    const [keyTransparency, stories] = await Promise.all([fetchKeyTransparencySelfStatus(), fetchStorySettings()]);
    setKeyTransparencyStatus(keyTransparency);
    setStorySettings(stories);
  });

  const onKeyTransparencyClick = async() => {
    if(keyTransparencyStatus() === 'running') return;
    setKeyTransparencyStatus('running');
    setKeyTransparencyStatus(await checkKeyTransparencySelf() ?? 'error');
  };

  // * the change shows at once and goes back when it fails, as in Web A
  const onStorySettingChange = async(update: SignalStorySettings) => {
    const previous = storySettings();
    setStorySettings({...previous, ...update});
    const updated = await updateStorySettings(update);
    if(!updated) {
      toastNew({langPackKey: 'Signal.Privacy.SaveFailed'});
      setStorySettings({...previous});
      return;
    }

    setStorySettings(updated);
  };

  const onMessageSettingChange = async(update: Partial<SignalMessageSettings>) => {
    const updated = await updateMessageSettings(update);
    if(!updated) {
      toastNew({langPackKey: 'Signal.Privacy.SaveFailed'});
      return;
    }

    setMessageSettings(updated);
  };

  const onPhoneNumberChange = async(update: {isShared?: boolean, isDiscoverable?: boolean}) => {
    const updated = await updatePhoneNumberPrivacy(update);
    if(!updated) {
      toastNew({langPackKey: 'Signal.Privacy.SaveFailed'});
      return;
    }

    setPhoneNumberPrivacy(updated);
  };

  const onDiscoveryChange = async(isEnabled: boolean) => {
    const updated = await setContactDiscovery(isEnabled);
    if(updated === undefined) {
      toastNew({langPackKey: 'Signal.Privacy.SaveFailed'});
      return;
    }

    setIsDiscoveryEnabled(updated as boolean);
  };

  const onRegistrationLockChange = async(isEnabled: boolean) => {
    const updated = await setRegistrationLock(isEnabled) as SignalPinSettings | undefined;
    if(!updated) {
      toastNew({langPackKey: 'Signal.Privacy.SaveFailed'});
      return;
    }

    setPinSettings(updated);
  };

  // * Create or change the PIN: the new one is asked for once, as the engine stores it without a confirmation
  const onPinClick = () => {
    const pinField = new InputField({
      label: 'SignalPinNew',
      plainText: true,
      required: true,
      withLinebreaks: false
    });

    confirmationPopup({
      titleLangKey: pinSettings()?.hasPin ? 'SignalPinChange' : 'SignalPinCreate',
      descriptionLangKey: 'SignalPinNewDescription',
      inputField: pinField,
      button: {
        langKey: 'Save',
        callback: async() => {
          const pin = pinField.value;
          if(pin.length < PIN_MIN_LENGTH) {
            toastNew({langPackKey: 'SignalPinErrorShort'});
            return false;
          }

          const updated = await setPin(pin) as SignalPinSettings | undefined;
          if(!updated) {
            toastNew({langPackKey: 'SignalPinErrorSave'});
            return false;
          }

          setPinSettings(updated);
        }
      }
    }).catch(() => {});
  };

  const onRemovePinClick = () => {
    confirmationPopup({
      titleLangKey: 'SignalPinRemove',
      descriptionLangKey: 'SignalPinRemoveText',
      button: {
        langKey: 'SignalPinRemove',
        isDanger: true,
        callback: async() => {
          const updated = await removePin() as SignalPinSettings | undefined;
          if(!updated) {
            toastNew({langPackKey: 'SignalPinErrorSave'});
            return false;
          }

          setPinSettings(updated);
        }
      }
    }).catch(() => {});
  };

  // * the passcode is set and changed in the A version, which keeps the vault (`src/util/passcode`)
  const onPasscodeClick = () => {
    switchToWebA();
  };

  const onAutoDeleteClick = () => {
    tab.slider.createTab(hotReloadGuard.tabs.AppMessagesAutoDeleteTab).open({
      period: autoDeletePeriod(),
      onSaved: setAutoDeletePeriod
    });
  };

  const onBlockedClick = async() => {
    const {peerIds} = await rootScope.managers.appUsersManager.getBlocked();
    tab.slider.createTab(hotReloadGuard.tabs.AppBlockedUsersTab).open({peerIds});
  };

  return (
    <>
      <Show when={messageSettings()}>
        {(settings) => (
          <Section name="Signal.Privacy.Messages">
            <Row>
              <Row.CheckboxFieldToggle>
                <CheckboxFieldTsx
                  checked={settings().isReadReceiptsEnabled}
                  onChange={(value) => onMessageSettingChange({isReadReceiptsEnabled: value})}
                  toggle
                />
              </Row.CheckboxFieldToggle>
              <Row.Title>{i18n('SignalReadReceipts')}</Row.Title>
              <Row.Subtitle>{i18n('SignalReadReceiptsAbout')}</Row.Subtitle>
            </Row>
            <Row>
              <Row.CheckboxFieldToggle>
                <CheckboxFieldTsx
                  checked={settings().isTypingIndicatorsEnabled}
                  onChange={(value) => onMessageSettingChange({isTypingIndicatorsEnabled: value})}
                  toggle
                />
              </Row.CheckboxFieldToggle>
              <Row.Title>{i18n('SignalTypingIndicators')}</Row.Title>
              <Row.Subtitle>{i18n('SignalTypingIndicatorsAbout')}</Row.Subtitle>
            </Row>
            <Row>
              <Row.CheckboxFieldToggle>
                <CheckboxFieldTsx
                  checked={settings().isLinkPreviewsEnabled}
                  onChange={(value) => onMessageSettingChange({isLinkPreviewsEnabled: value})}
                  toggle
                />
              </Row.CheckboxFieldToggle>
              <Row.Title>{i18n('SignalLinkPreviews')}</Row.Title>
              <Row.Subtitle>{i18n('SignalLinkPreviewsAbout')}</Row.Subtitle>
            </Row>
            <Row>
              <Row.CheckboxFieldToggle>
                <CheckboxFieldTsx
                  checked={settings().isSealedSenderIndicatorsEnabled}
                  onChange={(value) => onMessageSettingChange({isSealedSenderIndicatorsEnabled: value})}
                  toggle
                />
              </Row.CheckboxFieldToggle>
              <Row.Title>{i18n('SignalSealedSenderIndicators')}</Row.Title>
              <Row.Subtitle>{i18n('SignalSealedSenderIndicatorsAbout')}</Row.Subtitle>
            </Row>
          </Section>
        )}
      </Show>

      <Show when={autoDeletePeriod() !== undefined}>
        <Section caption="AutoDeleteMessages.InfoDefault">
          <Row clickable={onAutoDeleteClick}>
            <Row.Icon icon="auto_delete_filled" />
            <Row.Title>{i18n('AutoDeleteMessages')}</Row.Title>
            <Row.Subtitle>
              {autoDeletePeriod() ? findExistingOrCreateCustomOption(autoDeletePeriod()).label() : i18n('Off')}
            </Row.Subtitle>
          </Row>
        </Section>
      </Show>

      <Show when={phoneNumberPrivacy()}>
        {(privacy) => (
          <Section name="PrivacyPhoneTitle" caption={privacy().phoneNumber.visibility === 'everybody' ? 'SignalPhoneSharedInfo' : 'SignalPhoneHiddenInfo'}>
            <Row>
              <Row.CheckboxFieldToggle>
                <CheckboxFieldTsx
                  checked={privacy().phoneNumber.visibility === 'everybody'}
                  onChange={(value) => onPhoneNumberChange({isShared: value})}
                  toggle
                />
              </Row.CheckboxFieldToggle>
              <Row.Title>{i18n('Signal.Privacy.ShowPhone')}</Row.Title>
            </Row>
            <Row>
              <Row.CheckboxFieldToggle>
                <CheckboxFieldTsx
                  checked={privacy().addByPhone.visibility === 'everybody'}
                  onChange={(value) => onPhoneNumberChange({isDiscoverable: value})}
                  toggle
                />
              </Row.CheckboxFieldToggle>
              <Row.Title>{i18n('Signal.Privacy.FindByPhone')}</Row.Title>
              <Row.Subtitle>
                {i18n(privacy().addByPhone.visibility === 'everybody' ? 'SignalPhoneDiscoverableInfo' : 'SignalPhoneUnlistedInfo')}
              </Row.Subtitle>
            </Row>
          </Section>
        )}
      </Show>

      <Show when={isDiscoveryEnabled() !== undefined}>
        <Section caption="SignalContactDiscoveryAbout">
          <Row>
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx
                checked={!!isDiscoveryEnabled()}
                onChange={onDiscoveryChange}
                toggle
              />
            </Row.CheckboxFieldToggle>
            <Row.Title>{i18n('SignalContactDiscovery')}</Row.Title>
          </Row>
        </Section>
      </Show>

      <Show when={storySettings()}>
        {(settings) => (
          <Section name="StoriesSettingTitle">
            <Row>
              <Row.CheckboxFieldToggle>
                <CheckboxFieldTsx
                  checked={!settings().areStoriesDisabled}
                  onChange={(value) => onStorySettingChange({areStoriesDisabled: !value})}
                  toggle
                />
              </Row.CheckboxFieldToggle>
              <Row.Title>{i18n('StoriesSettingEnable')}</Row.Title>
              <Row.Subtitle>{i18n('StoriesSettingEnableInfo')}</Row.Subtitle>
            </Row>
            <Show when={!settings().areStoriesDisabled}>
              <Row>
                <Row.CheckboxFieldToggle>
                  <CheckboxFieldTsx
                    checked={!!settings().areViewReceiptsEnabled}
                    onChange={(value) => onStorySettingChange({areViewReceiptsEnabled: value})}
                    toggle
                  />
                </Row.CheckboxFieldToggle>
                <Row.Title>{i18n('StoriesSettingViewReceipts')}</Row.Title>
                <Row.Subtitle>{i18n('StoriesSettingViewReceiptsInfo')}</Row.Subtitle>
              </Row>
            </Show>
          </Section>
        )}
      </Show>

      <Section name="Signal.Privacy.Security">
        <Show when={pinSettings()}>
          {(pin) => (
            <>
              <Row clickable={onPinClick}>
                <Row.Icon icon="key" />
                <Row.Title titleRight={i18n(pin().hasPin ? 'SettingsItemPrivacyOn' : 'SettingsItemPrivacyOff')} titleRightSecondary>
                  {i18n('SignalPinSettings')}
                </Row.Title>
                <Row.Subtitle>{i18n('SignalPinAbout')}</Row.Subtitle>
              </Row>
              <Show when={pin().hasPin}>
                <Row>
                  <Row.CheckboxFieldToggle>
                    <CheckboxFieldTsx
                      checked={!!pin().isRegistrationLockEnabled}
                      onChange={onRegistrationLockChange}
                      toggle
                    />
                  </Row.CheckboxFieldToggle>
                  <Row.Title>{i18n('SignalPinRegistrationLock')}</Row.Title>
                  <Row.Subtitle>{i18n('SignalPinRegistrationLockAbout')}</Row.Subtitle>
                </Row>
                <Row color="danger" clickable={onRemovePinClick}>
                  <Row.Icon icon="delete" />
                  <Row.Title class="danger">{i18n('SignalPinRemove')}</Row.Title>
                </Row>
              </Show>
            </>
          )}
        </Show>
        <Row clickable={() => showRecoveryKeyPopup()}>
          <Row.Icon icon="key" />
          <Row.Title>{i18n('RecoveryKey')}</Row.Title>
        </Row>
        <Show when={keyTransparencyStatus()}>
          {(status) => (
            <Row clickable={status() === 'running' ? undefined : onKeyTransparencyClick}>
              <Row.Icon icon="check" />
              <Row.Title>{i18n('KeyTransTitle')}</Row.Title>
              <Row.Subtitle>{i18n(KEY_TRANSPARENCY_SELF_KEYS[status()])}</Row.Subtitle>
            </Row>
          )}
        </Show>
        <Row clickable={onBlockedClick}>
          <Row.Icon icon="user_block" />
          <Row.Title>{i18n('BlockedUsers')}</Row.Title>
        </Row>
        <Row clickable={onPasscodeClick}>
          <Row.Icon icon="lock" />
          <Row.Title titleRight={i18n(isPasscodeOn() ? 'SettingsItemPrivacyOn' : 'SettingsItemPrivacyOff')} titleRightSecondary>
            {i18n('PasscodeLock.Title')}
          </Row.Title>
        </Row>
      </Section>
    </>
  );
};

export default PrivacyAndSecurity;
