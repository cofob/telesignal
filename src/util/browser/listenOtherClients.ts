import { getActions, getGlobal, setGlobal } from '../../global';

import type { SharedState } from '../../global/types';

import { APP_CODE_NAME, INTERCLIENT_BROADCAST_CHANNEL } from '../../config';
import { stopCaching } from '../../global/cache';
import { updateTabState } from '../../global/reducers/tabs';
import { selectTabState } from '../../global/selectors';
import { parseSignalProxyUrl } from '../signalProxy';

// The shared settings that the other frontend changes (`webk/src/lib/signal/webAState.ts`) and stores itself
type SignalSharedSettingsMessage = {
  type: 'signalSharedSettings';
  settings: unknown;
};

type ProxySettings = Partial<Pick<SharedState['settings'], 'signalProxyUrl' | 'signalSealedSenderProxyUrl'>>;

const PROXY_SETTING_KEYS = ['signalProxyUrl', 'signalSealedSenderProxyUrl'] as const;

export default function listenOtherClients() {
  const channel = new BroadcastChannel(INTERCLIENT_BROADCAST_CHANNEL);

  channel.addEventListener('message', (event: MessageEvent<string | SignalSharedSettingsMessage>) => {
    const { data } = event;
    if (typeof data === 'object' && data?.type === 'signalSharedSettings') {
      const settings = parseProxySettings(data.settings);
      if (settings) getActions().applyOtherClientProxySettings(settings);
      return;
    }

    if (data === APP_CODE_NAME) return;

    // The other frontend runs the account from now on and may change or log it out: this tab writes nothing more of
    // its state, which would put the old state back, and it starts again with a reload
    stopCaching();

    let global = getGlobal();
    const tabState = selectTabState(global);
    global = updateTabState(global, {
      inactiveReason: 'otherClient',
    }, tabState.id);
    setGlobal(global);
  });

  channel.postMessage(APP_CODE_NAME);
}

// Only a URL that the proxy form would save, or `undefined` for the default, is taken
function parseProxySettings(settings: unknown) {
  if (typeof settings !== 'object' || !settings) return undefined;

  const changes: ProxySettings = {};
  PROXY_SETTING_KEYS.forEach((key) => {
    if (!(key in settings)) return;
    const value = (settings as Record<string, unknown>)[key];
    if (value === undefined || (typeof value === 'string' && parseSignalProxyUrl(value).url === value)) {
      changes[key] = value;
    }
  });

  return Object.keys(changes).length ? changes : undefined;
}
