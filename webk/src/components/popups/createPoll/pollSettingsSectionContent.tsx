import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import {I18nTsx} from '@helpers/solid/i18n';
import {LangPackKey} from '@lib/langPack';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import {useCreatePollContext} from './storeContext';

/**
 * TeleSignal: a Signal poll has one setting, multiple answers (Signal Desktop `PollCreateModal`); its voters are
 * always shown, and it has no quiz, added options, revote lock, shuffling, duration, country or subscriber limits
 */
export const PollSettingsSectionContent = (_props: {
  countriesElementRef?: (element: HTMLElement) => void
}) => {
  const context = useCreatePollContext();

  return (
    <SettingsOption
      title='NewPoll.AllowMultipleAnswers'
      subtitle='NewPoll.AllowMultipleAnswersSubtitle'
      icon='poll_multiple_answers_filled'
      checked={context.store.allowMultipleAnswers}
      onClick={() => context.setStore('allowMultipleAnswers', (prev) => !prev)}
    />
  );
};

const SettingsOption = (props: {
  title: LangPackKey;
  subtitle: LangPackKey;
  icon: Icon;
  disabled?: boolean;
  checked?: boolean;
  onClick?: () => void;
}) => {
  const {Row} = useHotReloadGuard();

  return (
    <Row disabled={props.disabled}>
      <Row.CheckboxFieldToggle>
        <CheckboxFieldTsx
          toggle
          checked={props.checked}
          disabled={props.disabled}
          lockIcon={props.disabled ? 'lock' : undefined}
          onChange={() => props.onClick?.()}
        />
      </Row.CheckboxFieldToggle>
      <Row.Icon icon={props.icon} />
      <Row.Title>
        <I18nTsx key={props.title} />
      </Row.Title>
      <Row.Subtitle><I18nTsx key={props.subtitle} /></Row.Subtitle>
    </Row>
  );
};
