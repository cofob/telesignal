import {createMemo, createSignal, For, Show} from 'solid-js';
import {Portal} from 'solid-js/web';
import Button from '@components/buttonTsx';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import InputField from '@components/inputField';
import SaveButton from '@components/saveButton';
import Section from '@components/section';
import showPickUserPopup from '@components/popups/pickUser';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {type AppNotificationProfileEditTab} from '@components/solidJsTabs/tabs';
import classNames from '@helpers/string/classNames';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import {toPeerId, toSignalPeerId} from '@lib/signal/builders';
import {
  deleteNotificationProfile,
  saveNotificationProfile,
  setNotificationProfileActive
} from '@lib/signal/notificationProfiles';
import {getWeekdayName} from '@components/sidebarLeft/tabs/notificationProfiles';

import styles from '@components/sidebarLeft/tabs/notificationProfileEdit.module.scss';

const MAX_NAME_LENGTH = 32;
const MAX_EMOJI_LENGTH = 8;
const TIME_BASE = 100;
const DEFAULT_START_TIME = 900;
const DEFAULT_END_TIME = 1700;
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
// * Signal Desktop's `DEFAULT_PROFILE_COLOR`, which a new profile of Web A gets
const DEFAULT_PROFILE_COLOR = 0xFF3F7BF7;
const SECONDS_PER_HOUR = 60 * 60;
const MS_PER_SECOND = 1000;

/**
 * TeleSignal: makes and changes a notification profile, as Web A's `NotificationProfileEditorModal`: its name and
 * emoji, the chats that notify while it is on, mentions and calls, and the schedule that turns it on by itself. A saved
 * profile can be turned on for an hour or deleted here, as Web A's list offers.
 */
const NotificationProfileEdit = () => {
  const [tab] = useSuperTab<typeof AppNotificationProfileEditTab>();
  const {Row, i18n, confirmationPopup, toastNew} = useHotReloadGuard();
  // * opened from the settings search without one: a new profile
  const profile = tab.payload?.profile;

  const nameField = new InputField({label: 'NotificationProfileName', plainText: true, maxLength: MAX_NAME_LENGTH});
  const emojiField = new InputField({label: 'NotificationProfileEmoji', plainText: true, maxLength: MAX_EMOJI_LENGTH});
  nameField.setValueSilently(profile?.name ?? '');
  emojiField.setValueSilently(profile?.emoji ?? '');
  const [name, setName] = createSignal(profile?.name ?? '');
  nameField.input.addEventListener('input', () => setName(nameField.value));

  const [chatIds, setChatIds] = createSignal(profile?.allowedChatIds ?? []);
  const [areAllMentionsAllowed, setAreAllMentionsAllowed] = createSignal(profile?.areAllMentionsAllowed ?? false);
  const [areAllCallsAllowed, setAreAllCallsAllowed] = createSignal(profile?.areAllCallsAllowed ?? false);
  const [isScheduleEnabled, setIsScheduleEnabled] = createSignal(profile?.isScheduleEnabled ?? false);
  const [startTime, setStartTime] = createSignal(profile?.scheduleStartTime ?? DEFAULT_START_TIME);
  const [endTime, setEndTime] = createSignal(profile?.scheduleEndTime ?? DEFAULT_END_TIME);
  const [days, setDays] = createSignal(profile?.scheduleDays.length ? profile.scheduleDays : WEEKDAYS);

  const isInvalid = createMemo(() => !name().trim() || (isScheduleEnabled() && (!days().length || startTime() === endTime())));

  const onChatsClick = () => {
    showPickUserPopup({
      titleLangKey: 'NotificationProfileAllowed',
      placeholder: 'Search',
      peerType: ['dialogs'],
      multiSelect: true,
      exceptSelf: true,
      initial: chatIds().map(toPeerId),
      footerButtonProps: {langKey: 'Save'},
      onSelect: (chosen) => {
        setChatIds(chosen.map(({peerId}) => toSignalPeerId(peerId)));
      }
    });
  };

  const save = async() => {
    if(isInvalid()) return;
    const saved = await saveNotificationProfile({
      id: profile?.id,
      name: name().trim(),
      emoji: emojiField.value.trim() || undefined,
      color: profile?.color ?? DEFAULT_PROFILE_COLOR,
      allowedChatIds: chatIds(),
      areAllCallsAllowed: areAllCallsAllowed(),
      areAllMentionsAllowed: areAllMentionsAllowed(),
      isScheduleEnabled: isScheduleEnabled(),
      scheduleStartTime: isScheduleEnabled() ? startTime() : undefined,
      scheduleEndTime: isScheduleEnabled() ? endTime() : undefined,
      scheduleDays: isScheduleEnabled() ? days() : []
    }).catch((): undefined => undefined);
    if(!saved) {
      toastNew({langPackKey: 'ErrorUnexpected'});
      return;
    }

    tab.close();
  };

  const onTurnOnForHour = async() => {
    const endsAt = Math.floor(Date.now() / MS_PER_SECOND) + SECONDS_PER_HOUR;
    if(!await setNotificationProfileActive(profile.id, endsAt).catch((): undefined => undefined)) {
      toastNew({langPackKey: 'ErrorUnexpected'});
      return;
    }

    tab.close();
  };

  const onDelete = () => {
    confirmationPopup({
      titleLangKey: 'NotificationProfileDelete',
      descriptionLangKey: 'NotificationProfileDeleteInfo',
      descriptionLangArgs: [profile.name],
      button: {langKey: 'Delete', isDanger: true}
    }).then(async() => {
      if(!await deleteNotificationProfile(profile.id).catch((): undefined => undefined)) {
        toastNew({langPackKey: 'ErrorUnexpected'});
        return;
      }

      tab.close();
    }, () => {});
  };

  const TimeInput = (props: {value: number, onChange: (value: number) => void}) => (
    <input
      type="time"
      class={styles.timeInput}
      value={formatTimeInput(props.value)}
      onChange={(e) => props.onChange(parseTimeInput(e.currentTarget.value, props.value))}
    />
  );

  return (
    <>
      <Portal mount={tab.header}>
        <SaveButton hasChanges={!isInvalid()} onClick={() => void save()} />
      </Portal>

      <Section>
        <div class={styles.name}>
          <div class={styles.emoji}>{emojiField.container}</div>
          {nameField.container}
        </div>
      </Section>

      <Section>
        <Row clickable={onChatsClick}>
          <Row.Icon icon="group" />
          <Row.Title>{i18n('NotificationProfileAllowed')}</Row.Title>
          <Row.Subtitle>
            {chatIds().length ?
              i18n('NotificationProfileChats', [chatIds().length]) :
              i18n('NotificationProfileNobody')}
          </Row.Subtitle>
        </Row>
        <Row>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx checked={areAllMentionsAllowed()} onChange={setAreAllMentionsAllowed} toggle />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('NotificationProfileMentions')}</Row.Title>
        </Row>
        <Row>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx checked={areAllCallsAllowed()} onChange={setAreAllCallsAllowed} toggle />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('NotificationProfileCalls')}</Row.Title>
        </Row>
      </Section>

      <Section>
        <Row>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx checked={isScheduleEnabled()} onChange={setIsScheduleEnabled} toggle />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('NotificationProfileSchedule')}</Row.Title>
        </Row>
        <Show when={isScheduleEnabled()}>
          <div class={styles.days}>
            <For each={ALL_DAYS}>
              {(day) => (
                <Button
                  class={classNames(styles.day, days().includes(day) && styles.dayOn)}
                  onClick={() => setDays(days().includes(day) ? days().filter((item) => item !== day) : [...days(), day])}
                >
                  {getWeekdayName(day)}
                </Button>
              )}
            </For>
          </div>
          <label class={styles.time}>
            {i18n('NotificationProfileFrom')}
            <TimeInput value={startTime()} onChange={setStartTime} />
          </label>
          <label class={styles.time}>
            {i18n('NotificationProfileUntil')}
            <TimeInput value={endTime()} onChange={setEndTime} />
          </label>
        </Show>
      </Section>

      <Show when={profile}>
        <Section>
          <Row clickable={onTurnOnForHour}>
            <Row.Icon icon="recent" />
            <Row.Title>{i18n('NotificationProfileForHour')}</Row.Title>
          </Row>
          <Row color="danger" clickable={onDelete}>
            <Row.Icon icon="delete" />
            <Row.Title class="danger">{i18n('NotificationProfileDelete')}</Row.Title>
          </Row>
        </Section>
      </Show>
    </>
  );
};

/** `09:30` of the time number 930 */
function formatTimeInput(time: number) {
  const hours = Math.floor(time / TIME_BASE);
  const minutes = time % TIME_BASE;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The time number 930 of `09:30`; an empty input keeps the time */
function parseTimeInput(value: string, fallback: number) {
  const [hours, minutes] = value.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * TIME_BASE + minutes : fallback;
}

export default NotificationProfileEdit;
