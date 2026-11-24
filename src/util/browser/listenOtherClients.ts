import { getGlobal, setGlobal } from '../../global';

import type { SharedState } from '../../global/types';

import { APP_CODE_NAME, INTERCLIENT_BROADCAST_CHANNEL } from '../../config';
import { stopCaching } from '../../global/cache';
import { updateSharedSettings } from '../../global/reducers';
import { updateTabState } from '../../global/reducers/tabs';
import { selectTabState } from '../../global/selectors';

// The shared settings that the other frontend changes (`webk/src/lib/signal/webAState.ts`) and stores itself
type SignalSharedSettingsMessage = {
  type: 'signalSharedSettings';
  settings: Partial<Pick<SharedState['settings'], 'signalProxyUrl' | 'signalSealedSenderProxyUrl'>>;
};

const SHARED_SETTING_KEYS = ['signalProxyUrl', 'signalSealedSenderProxyUrl'] as const;

export default function listenOtherClients() {
  const channel = new BroadcastChannel(INTERCLIENT_BROADCAST_CHANNEL);

  channel.addEventListener('message', (event: MessageEvent<string | SignalSharedSettingsMessage>) => {
    const { data } = event;
    if (typeof data === 'object' && data?.type === 'signalSharedSettings') {
      applySharedSettings(data.settings);
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

// The other frontend has stored the settings already; the tabs share them through the shared state worker
function applySharedSettings(settings: SignalSharedSettingsMessage['settings']) {
  const changes: SignalSharedSettingsMessage['settings'] = {};
  SHARED_SETTING_KEYS.forEach((key) => {
    if (key in settings) changes[key] = settings[key];
  });

  let global = getGlobal();
  global = updateSharedSettings(global, changes);
  setGlobal(global);
}
