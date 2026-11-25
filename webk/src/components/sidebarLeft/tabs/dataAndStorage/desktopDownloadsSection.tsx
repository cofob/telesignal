import {createSignal, onMount} from 'solid-js';
import {i18n} from '@lib/langPack';
import Row from '@components/rowTsx';
import Section from '@components/section';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import {toastNew} from '@components/toast';
import {readWebASharedSettings, updateWebASharedSettings} from '@lib/signal/webAState';

/**
 * Whether the app asks where to save each download (`lib/signal/desktopFiles`), Web A's setting of Data and Storage
 * (`shouldAskWhereToSave`), which both frontends share
 */
export function DesktopDownloadsSection() {
  const [shouldAsk, setShouldAsk] = createSignal(false);

  onMount(() => {
    readWebASharedSettings().then(({shouldAskWhereToSave}) => setShouldAsk(!!shouldAskWhereToSave), logError);
  });

  const change = (shouldAskWhereToSave: boolean) => {
    setShouldAsk(shouldAskWhereToSave);
    updateWebASharedSettings({shouldAskWhereToSave}).catch((err) => {
      logError(err);
      setShouldAsk(!shouldAskWhereToSave);
      toastNew({langPackKey: 'Error.AnError'});
    });
  };

  return (
    <Section name="Signal.Desktop.Settings">
      <Row>
        <Row.CheckboxFieldToggle>
          <CheckboxFieldTsx checked={shouldAsk()} onChange={change} toggle />
        </Row.CheckboxFieldToggle>
        <Row.Title>{i18n('Signal.Desktop.AskWhereToSave')}</Row.Title>
        <Row.Subtitle>{i18n('Signal.Desktop.AskWhereToSaveDescription')}</Row.Subtitle>
      </Row>
    </Section>
  );
}

function logError(err: unknown) {
  console.error('Desktop download settings failed:', err);
}
