import {createSignal, onMount, Show} from 'solid-js';
import {i18n} from '@lib/langPack';
import Row from '@components/rowTsx';
import Section from '@components/section';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import {toastNew} from '@components/toast';
import {CAN_PROTECT_CONTENT, DesktopSettings, fetchDesktopSettings, updateDesktopSettings} from '@lib/signal/desktopApp';
import {readWebASharedSettings, updateWebASharedSettings} from '@lib/signal/webAState';

/**
 * TeleSignal: the settings that the desktop app keeps itself and applies before the page loads
 * (`tauri/src/settings.rs`), as Web A's General settings show them (`SettingsDesktopApp`). Only the app renders it.
 */
export function DesktopAppSection() {
  const [settings, setSettings] = createSignal<DesktopSettings>();

  onMount(() => {
    fetchDesktopSettings().then(setSettings, logError);
  });

  const change = async(patch: Partial<DesktopSettings>) => {
    setSettings((current) => current && {...current, ...patch});
    try {
      setSettings(await updateDesktopSettings(patch));
    } catch(err) {
      logError(err);
      toastNew({langPackKey: 'Error.AnError'});
      fetchDesktopSettings().then(setSettings, logError);
    }
  };

  return (
    <Show when={settings()}>
      <Section name="Signal.Desktop.Settings">
        <Row>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx
              checked={settings().shouldCloseToTray}
              onChange={(shouldCloseToTray) => change({shouldCloseToTray})}
              toggle
            />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('Signal.Desktop.Tray')}</Row.Title>
          <Row.Subtitle>{i18n('Signal.Desktop.TrayDescription')}</Row.Subtitle>
        </Row>
        <Row>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx
              checked={settings().shouldLaunchAtLogin}
              onChange={(shouldLaunchAtLogin) => change({shouldLaunchAtLogin})}
              toggle
            />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('Signal.Desktop.Autostart')}</Row.Title>
          <Row.Subtitle>{i18n('Signal.Desktop.AutostartDescription')}</Row.Subtitle>
        </Row>
        <Show when={CAN_PROTECT_CONTENT}>
          <Row>
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx
                checked={settings().isContentProtected}
                onChange={(isContentProtected) => change({isContentProtected})}
                toggle
              />
            </Row.CheckboxFieldToggle>
            <Row.Title>{i18n('Signal.Desktop.Protect')}</Row.Title>
            <Row.Subtitle>{i18n('Signal.Desktop.ProtectDescription')}</Row.Subtitle>
          </Row>
        </Show>
      </Section>
    </Show>
  );
}

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
  console.error('Desktop settings failed:', err);
}
