import tsNow from '@helpers/tsNow';
import {LangPackKey} from '@lib/langPack';
import {MUTE_UNTIL} from '@appManagers/constants';
import RadioFormTsx from '@components/radioFormTsx';
import showPeerPopup, {PopupPeerButton} from '@components/popups/peer';
import showDatePickerPopup from '@components/popups/datePicker';
import {createComponent} from 'solid-js';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';

const ONE_HOUR = 3600;
const FOREVER = -1;
// * tdesktop's "Mute for...": a time of the user's own, picked in the date picker
const CUSTOM = 0;
const times: {value: number, langPackKey: LangPackKey, checked?: boolean}[] = [{
  value: ONE_HOUR,
  langPackKey: 'ChatList.Mute.1Hour'
}, {
  value: ONE_HOUR * 4,
  langPackKey: 'ChatList.Mute.4Hours'
}, {
  value: ONE_HOUR * 8,
  langPackKey: 'ChatList.Mute.8Hours'
}, {
  value: ONE_HOUR * 24,
  langPackKey: 'ChatList.Mute.1Day'
}, {
  value: ONE_HOUR * 24 * 3,
  langPackKey: 'ChatList.Mute.3Days'
}, {
  value: FOREVER,
  langPackKey: 'ChatList.Mute.Forever',
  checked: true
}, {
  value: CUSTOM,
  langPackKey: 'MuteForPopup'
}];

/**
 * Every "Mute" of a chat or a topic — the chat list, the top bar, the profile — as tdesktop's mute
 * menu (`menu/menu_mute.cpp`): a duration or one of the user's own. TeleSignal: Signal keeps no sound setting of a
 * chat, only its mute, so the menu has no sound button.
 */
export default function showMutePopup(
  peerId: PeerId,
  threadId?: number
) {
  const managers = bindManagersToSession(rootScope.managers);

  let time = times.find((option) => option.checked).value;

  const mute = (muteUntil: number) => {
    managers.appMessagesManager.mutePeer({peerId, muteUntil, threadId});
  };

  const buttons: PopupPeerButton[] = [{
    langKey: 'ChatList.Context.Mute',
    callback: () => {
      if(time !== CUSTOM) {
        mute(time === FOREVER ? MUTE_UNTIL : tsNow(true) + time);
        return;
      }

      showDatePickerPopup({
        initDate: new Date(),
        addMinutes: true,
        minDate: new Date(),
        withTime: true,
        btnConfirmLangKey: 'ChatList.Context.Mute',
        onPick: (muteUntil) => {
          // * a time already gone mutes nothing, as iOS's picker closes then: sent, it would end the chat's mute
          if(muteUntil > tsNow(true)) {
            mute(muteUntil);
          }
        }
      });
    }
  }];

  showPeerPopup('popup-mute', {
    peerId,
    titleLangKey: 'Notifications',
    buttons,
    content: createComponent(RadioFormTsx<number | string>, {
      values: times,
      onChange: (value) => {
        time = +value;
      }
    })
  });
}
