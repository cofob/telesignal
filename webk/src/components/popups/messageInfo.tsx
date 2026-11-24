import {For} from 'solid-js';
import showPeerPopup from '@components/popups/peer';
import {toastNew} from '@components/toast';
import RowTsx from '@components/rowTsx';
import {AvatarNewTsx} from '@components/avatarNew';
import {PeerTitleTsx} from '@components/peerTitleTsx';
import {i18n, LangPackKey} from '@lib/langPack';
import rootScope from '@lib/rootScope';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import type {MessageRecipient, MessageRecipientStatus} from '@lib/signal/messageInfo';
import styles from './messageInfo.module.scss';

// * the order of Signal Desktop's message details (`VISIBLE_SEND_STATUS_ORDER`), as Web A shows them
const STATUS_ORDER: MessageRecipientStatus[] = ['failed', 'viewed', 'read', 'delivered', 'sent', 'pending'];
const STATUS_TITLE_KEYS: Record<MessageRecipientStatus, LangPackKey> = {
  failed: 'Signal.MessageInfo.NotSent',
  viewed: 'Signal.MessageInfo.Viewed',
  read: 'Signal.MessageInfo.Read',
  delivered: 'Signal.MessageInfo.Delivered',
  sent: 'Signal.MessageInfo.Sent',
  pending: 'Signal.MessageInfo.Pending'
};
const AVATAR_SIZE = 42;

/** How an outgoing message reached each recipient (Signal Desktop `MessageDetail`), grouped by status */
export default async function showMessageInfoPopup(peerId: PeerId, mid: number) {
  const managers = bindManagersToSession(rootScope.managers);
  const recipients = await managers.appSignalManager.fetchMessageRecipients(peerId, mid);
  if(!recipients) {
    toastNew({langPackKey: 'Error.AnError'});
    return;
  }

  const groups = STATUS_ORDER
  .map((status) => ({status, recipients: recipients.filter((recipient) => recipient.status === status)}))
  .filter((group) => group.recipients.length);

  showPeerPopup('popup-message-info', {
    titleLangKey: 'Signal.MessageInfo.Title',
    scrollable: true,
    content: (
      <div class={styles.groups}>
        <For each={groups}>{(group) => (
          <div>
            <div class={styles.title}>{i18n(STATUS_TITLE_KEYS[group.status])}</div>
            <For each={group.recipients}>{(recipient: MessageRecipient) => (
              <RowTsx>
                <RowTsx.Title><PeerTitleTsx peerId={recipient.peerId} /></RowTsx.Title>
                <RowTsx.Media size="abitbigger"><AvatarNewTsx peerId={recipient.peerId} size={AVATAR_SIZE} /></RowTsx.Media>
              </RowTsx>
            )}</For>
          </div>
        )}</For>
      </div>
    ),
    buttons: [{langKey: 'Close', isCancel: true}]
  });
}
