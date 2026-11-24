import {createMemo, createSignal, onMount, Show} from 'solid-js';
import cancelEvent from '@helpers/dom/cancelEvent';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import Row from '@components/rowTsx';
import Section from '@components/section';
import {toastNew} from '@components/toast';
import RangeSettingSelector from '@components/rangeSettingSelector';
import Button from '@components/buttonTsx';
import {SETTINGS_INIT} from '@config/state';
import IS_NOTIFICATION_SUPPORTED from '@environment/notificationSupport';
import {IS_DESKTOP_APP} from '@lib/signal/desktopApp';
import {i18n, LangPackKey} from '@lib/langPack';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import {useAppSettings} from '@stores/appSettings';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import {
  fetchNotifyDefaults,
  SignalNotifyDefault,
  updateNotifyDefault
} from '@lib/signal/settingsApi';

/**
 * Signal's notification defaults of one kind of chat, which a chat's own settings override. Notifications and previews
 * stay on this device, as the engine keeps them.
 */
const SignalNotifySection = (props: {name: LangPackKey, typeText: LangPackKey, peerType: 'users' | 'groups'}) => {
  const [defaults, setDefaults] = createSignal<SignalNotifyDefault>();

  const load = async() => {
    const all = await fetchNotifyDefaults();
    setDefaults(all?.[props.peerType]);
  };

  onMount(() => {
    load();
  });

  const update = async(change: {isMuted?: boolean, shouldShowPreviews?: boolean}) => {
    const current = defaults();
    if(!current) return;

    const saved = await updateNotifyDefault(props.peerType, {
      isMuted: !!current.mutedUntil,
      shouldShowPreviews: !!current.shouldShowPreviews,
      ...change
    });
    if(saved === undefined) {
      toastNew({langPackKey: 'Signal.Notifications.SaveFailed'});
    }

    load();
  };

  return (
    <Section name={props.name}>
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx
            checked={!!defaults() && !defaults().mutedUntil}
            onChange={(value) => update({isMuted: !value})}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n(props.typeText)}</Row.Title>
      </Row>
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx
            checked={!!defaults()?.shouldShowPreviews}
            onChange={(value) => update({shouldShowPreviews: value})}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('MessagePreview')}</Row.Title>
      </Row>
    </Section>
  );
};

const NotificationsSection = () => {
  const {uiNotificationsManager} = useHotReloadGuard();
  const [appSettings, setAppSettings] = useAppSettings();
  const [permission, setPermission] = createSignal<NotificationPermission>(
    // * TeleSignal: the desktop app shows system notifications, which need no permission of the page
    IS_DESKTOP_APP ? 'granted' : (IS_NOTIFICATION_SUPPORTED ? Notification.permission : 'denied')
  );
  const isGranted = createMemo(() => permission() === 'granted');

  const onClick = (e: MouseEvent) => {
    cancelEvent(e);
    if(!IS_NOTIFICATION_SUPPORTED) {
      toastNew({langPackKey: 'Notifications.Restricted'});
      return;
    }

    // const now = Date.now();
    Notification.requestPermission().then((permission) => {
      setPermission(permission);
      if(permission === 'granted') {
        uiNotificationsManager.onPushConditionsChange();
      } else {
        throw 1;
      }
    }, () => {
      // if((Date.now() - now) < 100) {
      toastNew({langPackKey: 'Notifications.Restricted'});
      // }
    });
  };

  const NotificationRow = (props: Parameters<typeof Row>[0]) => {
    return (
      <Row
        {...props}
        fakeDisabled={!isGranted()}
        clickable={!isGranted() && onClick}
      />
    );
  };

  const NotificationCheckbox = (props: Parameters<typeof CheckboxFieldTsx>[0]) => {
    return (
      <CheckboxFieldTsx
        {...props}
        checked={isGranted() && props.checked}
      />
    );
  };

  return (
    <Section
      name="Notifications.Web"
      caption={isGranted() ? 'MultiAccount.ShowNotificationsFromCaption' : 'Notifications.Default'}
    >
      <NotificationRow>
        <Row.CheckboxFieldToggle>
          <NotificationCheckbox
            checked={appSettings.notifications.desktop}
            onChange={(value) => setAppSettings('notifications', 'desktop', value)}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('Notifications.Show')}</Row.Title>
      </NotificationRow>
      <NotificationRow>
        <Row.CheckboxFieldToggle>
          <NotificationCheckbox
            checked={appSettings.notifications.push}
            onChange={(value) => setAppSettings('notifications', 'push', value)}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('Notifications.Offline')}</Row.Title>
      </NotificationRow>
      <NotificationRow>
        <Row.CheckboxFieldToggle>
          <NotificationCheckbox
            checked={appSettings.notifyAllAccounts}
            onChange={(value) => setAppSettings('notifyAllAccounts', value)}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('MultiAccount.AllAccounts')}</Row.Title>
      </NotificationRow>
      {!isGranted() && (
        <Button
          text="Notifications.Enable"
          class="btn-primary primary btn-transparent"
          icon="unmute"
          disabled={isGranted()}
          onClick={onClick}
        />
      )}
    </Section>
  );
};

const SoundSection = () => {
  const {uiNotificationsManager} = useHotReloadGuard();
  const [appSettings, setAppSettings] = useAppSettings();

  return (
    <Section
      name="Notifications.Sound.Section"
      caption="Notifications.Sound.Caption"
    >
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx
            checked={appSettings.notifications.sound}
            onChange={(value) => {
              if(value && !appSettings.notifications.volume) {
                setAppSettings('notifications', 'volume', SETTINGS_INIT.notifications.volume);
              }

              setAppSettings('notifications', 'sound', value);
            }}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('Notifications.Sound')}</Row.Title>
      </Row>
      <RangeSettingSelector
        textLeft={i18n('Notifications.Sound.Volume')}
        textRight={(value) => '' + Math.floor(value * 100) + '%'}
        step={0.01}
        value={appSettings.notifications.volume}
        minValue={0}
        maxValue={1}
        onChange={(value) => {
          value = +value.toFixed(2);
          if(!value) {
            setAppSettings('notifications', 'sound', false);
          }

          setAppSettings('notifications', 'volume', value);
        }}
        onMouseUp={() => {
          uiNotificationsManager.testSound(appSettings.notifications.volume);
        }}
      />
    </Section>
  );
};

const SoundEffectsSection = () => {
  const [appSettings, setAppSettings] = useAppSettings();

  return (
    <Section name="Notifications.Sound.Effects">
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx
            checked={appSettings.notifications.sentMessageSound}
            onChange={(value) => setAppSettings('notifications', 'sentMessageSound', value)}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('Notifications.Sound.Sent')}</Row.Title>
      </Row>
    </Section>
  );
};

// * TeleSignal: Signal's notification profiles, and the notifications of pinned messages (Web A's `SettingsNotifications`)
const SignalProfilesSection = () => {
  const [tab] = useSuperTab();
  return (
    <Section>
      <Row clickable={() => tab.slider.createTab(hotReloadGuard.tabs.AppNotificationProfilesTab).open()}>
        <Row.Icon icon="mute" />
        <Row.Title>{i18n('NotificationProfiles')}</Row.Title>
      </Row>
    </Section>
  );
};

const SignalOtherSection = () => {
  const [appSettings, setAppSettings] = useAppSettings();
  return (
    <Section name="PhoneOther">
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx
            checked={!appSettings.notifications.nopinned}
            onChange={(value) => setAppSettings('notifications', 'nopinned', value ? undefined : true)}
            toggle
          />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('PinnedMessagesNotifications')}</Row.Title>
      </Row>
    </Section>
  );
};

const Notifications = () => {
  return (
    <>
      <SignalProfilesSection />
      <NotificationsSection />
      <SoundSection />
      <SoundEffectsSection />
      <SignalNotifySection
        name="NotificationsPrivateChats"
        typeText="NotificationsForPrivateChats"
        peerType="users"
      />
      <SignalNotifySection
        name="NotificationsGroups"
        typeText="NotificationsForGroups"
        peerType="groups"
      />
      <SignalOtherSection />
    </>
  );
};

export default Notifications;
