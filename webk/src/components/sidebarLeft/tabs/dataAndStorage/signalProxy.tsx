import {createSignal, onMount} from 'solid-js';
import {i18n} from '@lib/langPack';
import Row from '@components/rowTsx';
import Section from '@components/section';
import showSignalProxyPopup from '@components/popups/signalProxy';
import {getSignalProxySettings, SignalProxySettings} from '@lib/signal/proxySettings';

type ProxyKey = keyof SignalProxySettings;

/**
 * The proxy servers of the Signal engine, as Web A's Data and Storage settings show them (`SettingsDataStorage`):
 * the tunnel of every connection, and the one of the connections without the account's credentials. The settings
 * are Web A's own, and a change restarts the engine with them.
 */
export function SignalProxySection() {
  const [settings, setSettings] = createSignal<SignalProxySettings>({});

  // * read again after every save: a save whose engine restart failed has stored the URL all the same
  const load = async() => {
    setSettings(await getSignalProxySettings().catch((): SignalProxySettings => ({})));
  };

  onMount(load);

  const getHost = (url: string) => new URL(url).host;

  const openForm = (key: ProxyKey) => showSignalProxyPopup(key, settings()[key], load);

  return (
    <Section name="SignalProxySection">
      <Row clickable={() => openForm('signalProxyUrl')}>
        <Row.Icon icon="link" />
        <Row.Title>{i18n('SignalProxyTitle')}</Row.Title>
        <Row.Subtitle>
          {settings().signalProxyUrl ? getHost(settings().signalProxyUrl) : i18n('SignalProxyDefault')}
        </Row.Subtitle>
      </Row>
      <Row clickable={() => openForm('signalSealedSenderProxyUrl')}>
        <Row.Icon icon="lock" />
        <Row.Title>{i18n('SignalSealedProxyTitle')}</Row.Title>
        <Row.Subtitle>
          {settings().signalSealedSenderProxyUrl ?
            getHost(settings().signalSealedSenderProxyUrl) :
            i18n('SignalSealedProxySame')}
        </Row.Subtitle>
      </Row>
    </Section>
  );
}
