import {createSignal} from 'solid-js';
import showDatePickerPopup from '@components/popups/datePicker';
import PopupElement from '@components/popups/indexTsx';
import Button from '@components/buttonTsx';
import I18n from '@lib/langPack';
import {SEND_WHEN_ONLINE_TIMESTAMP} from '@appManagers/constants';

export type ScheduleSendingPopupOptions = {
  initDate?: Date,
  addMinutes?: boolean,
  initRepeatPeriod?: number,
  initSilent?: boolean,
  canSendSilently?: boolean,
  canSendWhenOnline?: boolean,
  onPick: (timestamp: number, repeatPeriod: number | undefined, silent: boolean) => void
};

/**
 * Schedule-message variant of the date picker.
 *
 * Wraps {@link showDatePickerPopup} with a schedule-specific extra that
 * doesn't belong in the generic picker: a "Send when online" secondary footer
 * button that emits a sentinel {@link SEND_WHEN_ONLINE_TIMESTAMP}
 *
 * The picker stays domain-agnostic; everything specific to scheduling
 * messages lives here.
 */
export default function showScheduleSendingPopup(opts: ScheduleSendingPopupOptions): void {
  let selectedSilent = !!opts.initSilent;

  showDatePickerPopup({
    initDate: opts.initDate ?? new Date(),
    addMinutes: opts.addMinutes ?? (opts.initDate === undefined),
    withTime: true,
    onPick: (timestamp) => {
      opts.onPick(timestamp, opts.initRepeatPeriod || undefined, selectedSilent);
    },
    headerActions: opts.canSendSilently === false ? undefined : () => (
      <SilentToggle
        initValue={selectedSilent}
        onChange={(value) => selectedSilent = value}
      />
    ),
    footerAfter: opts.canSendWhenOnline ? () => (
      <PopupElement.FooterButton
        color="secondary"
        class="popup-schedule-secondary"
        langKey="Schedule.SendWhenOnline"
        callback={() => opts.onPick(SEND_WHEN_ONLINE_TIMESTAMP, undefined, selectedSilent)}
      />
    ) : undefined
  });
}

function SilentToggle(props: {initValue: boolean, onChange: (value: boolean) => void}) {
  const [silent, setSilent] = createSignal(props.initValue);

  const onClick = () => {
    const value = !silent();
    setSilent(value);
    props.onChange(value);
  };

  return (
    <Button.Icon
      icon={silent() ? 'mute' : 'unmute'}
      class="date-picker-silent primary"
      tabIndex={0}
      aria-pressed={silent()}
      aria-label={I18n.format('Chat.Send.WithoutSound', true)}
      on:keydown={(event) => {
        if(event.key === 'Enter') event.stopPropagation();
      }}
      onClick={onClick}
    />
  );
}

