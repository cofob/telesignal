import {createSignal, For, onCleanup, onMount, Show} from 'solid-js';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import Section from '@components/section';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {type AppNotificationProfilesTab} from '@components/solidJsTabs/tabs';
import I18n from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import {
  fetchNotificationProfiles,
  setNotificationProfileActive,
  SignalNotificationProfile,
  SignalNotificationProfilesState
} from '@lib/signal/notificationProfiles';

const MS_PER_SECOND = 1000;
const TIME_BASE = 100;
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];
const DAYS_IN_WEEK = 7;
// * a Monday, from which the names of the days are taken
const MONDAY = new Date(2024, 0, 1);

/**
 * TeleSignal: Signal's notification profiles, as Web A's `SettingsNotificationProfiles` (Signal Desktop's notification
 * profiles of its preferences): who notifies while a profile is on, and the schedule that turns it on. They are in the
 * storage service, so they follow the phone, and a profile can be turned on here by hand.
 */
const NotificationProfiles = () => {
  const [tab] = useSuperTab<typeof AppNotificationProfilesTab>();
  const {Row, i18n, toastNew} = useHotReloadGuard();
  const [state, setState] = createSignal<SignalNotificationProfilesState>();

  const onState = (value: SignalNotificationProfilesState) => setState(value);
  rootScope.addEventListener('signal_notification_profiles', onState);
  onCleanup(() => rootScope.removeEventListener('signal_notification_profiles', onState));

  onMount(async() => {
    setState(await fetchNotificationProfiles());
  });

  const openEditor = (profile?: SignalNotificationProfile) => {
    tab.slider.createTab(hotReloadGuard.tabs.AppNotificationProfileEditTab).open({profile});
  };

  const onToggle = async(id: string, isOn: boolean) => {
    const value = await setNotificationProfileActive(isOn ? id : undefined).catch((): undefined => undefined);
    if(!value) {
      toastNew({langPackKey: 'ErrorUnexpected'});
      return;
    }

    setState(value);
  };

  /** Whether the profile is on, until when, and its schedule (Web A's `getSubtitle`) */
  const getSubtitle = (profile: SignalNotificationProfile) => {
    const value = state();
    const parts: string[] = [];
    if(value.activeProfileId === profile.id) {
      const endsAt = value.overrideEndsAt ?? value.nextChangeAt;
      parts.push(endsAt ?
        I18n.format('NotificationProfileOnUntil', true, [formatTime(new Date(endsAt * MS_PER_SECOND))]) :
        I18n.format('NotificationProfileOn', true));
    }

    if(profile.isScheduleEnabled && profile.scheduleStartTime !== undefined && profile.scheduleEndTime !== undefined) {
      parts.push(`${getDaysLabel(profile.scheduleDays)}, ${formatScheduleTime(profile.scheduleStartTime)} - ${
        formatScheduleTime(profile.scheduleEndTime)}`);
    }

    if(!parts.length) parts.push(I18n.format('NotificationProfileOff', true));
    return parts.join(' · ');
  };

  return (
    <Show when={state()}>
      <Section caption="NotificationProfilesInfo" captionTop noContent />
      <Show when={state().isSyncDisabled}>
        <Section caption="NotificationProfilesSyncOff" noContent />
      </Show>
      <Section>
        <For each={state().profiles}>
          {(profile) => (
            <Row clickable={() => openEditor(profile)}>
              <Row.Title>{`${profile.emoji || '🔕'} ${profile.name}`}</Row.Title>
              <Row.Subtitle>{getSubtitle(profile)}</Row.Subtitle>
              <Row.CheckboxFieldToggle>
                {/* * turning a profile on or off does not open it */}
                <span onClick={(e) => e.stopPropagation()}>
                  <CheckboxFieldTsx
                    checked={state().activeProfileId === profile.id}
                    onChange={(isOn) => onToggle(profile.id, isOn)}
                    toggle
                  />
                </span>
              </Row.CheckboxFieldToggle>
            </Row>
          )}
        </For>
        <Show when={!state().isSyncDisabled}>
          <Row clickable={() => openEditor()}>
            <Row.Icon icon="add" />
            <Row.Title>{i18n('NotificationProfileNew')}</Row.Title>
          </Row>
        </Show>
      </Section>
    </Show>
  );
};

export function getWeekdayName(day: number) {
  const date = new Date(MONDAY);
  date.setDate(MONDAY.getDate() + day - 1);
  return new Intl.DateTimeFormat(I18n.getLastRequestedLangCode(), {weekday: 'short'}).format(date);
}

function getDaysLabel(days: number[]) {
  if(days.length === DAYS_IN_WEEK) return I18n.format('NotificationProfileDaily', true);
  if(days.length === WEEKDAYS.length && WEEKDAYS.every((day) => days.includes(day))) {
    return I18n.format('NotificationProfileWeekdays', true);
  }

  if(days.length === WEEKEND.length && WEEKEND.every((day) => days.includes(day))) {
    return I18n.format('NotificationProfileWeekends', true);
  }

  return [...days].sort().map(getWeekdayName).join(', ');
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat(I18n.getLastRequestedLangCode(), {hour: 'numeric', minute: '2-digit'}).format(date);
}

function formatScheduleTime(time: number) {
  return formatTime(new Date(2024, 0, 1, Math.floor(time / TIME_BASE), time % TIME_BASE));
}

export default NotificationProfiles;
