import {createResource, For, Show} from 'solid-js';
import {AvatarNewTsx} from '@components/avatarNew';
import PeerTitle from '@components/peerTitle';
import {PeerTitleTsx} from '@components/peerTitleTsx';
import Row from '@components/rowTsx';
import Section from '@components/section';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {type AppPendingInvitesTab} from '@components/solidJsTabs/tabs';
import noop from '@helpers/noop';
import {Chat} from '@layer';
import hasRights from '@appManagers/utils/chats/hasRights';
import {toSignalPeerId} from '@lib/signal/builders';
import type {SignalPendingInvite} from '@lib/signal/signalApi';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';

/**
 * TeleSignal: the people invited to a group who have not accepted yet, as Web A's `ManageGroupInvitedUsers`. An admin
 * takes an invitation back from its row; the invitations are read from the full chat (`signal_pending_invites`).
 */
const PendingInvites = () => {
  const [tab] = useSuperTab<typeof AppPendingInvitesTab>();
  const {i18n, confirmationPopup, toastNew} = useHotReloadGuard();
  const {managers} = tab;
  const chatId = tab.payload.chatId;

  const [data, {refetch}] = createResource(async() => {
    const [chat, chatFull] = await Promise.all([
      managers.appChatsManager.getChat(chatId) as Promise<Chat.chat>,
      managers.appProfileManager.getChatFull(chatId, true)
    ]);
    const invites = (chatFull as {signal_pending_invites?: SignalPendingInvite[]}).signal_pending_invites ?? [];
    return {invites, canRevoke: hasRights(chat, 'invite_users') && hasRights(chat, 'just_admin')};
  });

  const revoke = (invite: SignalPendingInvite) => {
    confirmationPopup({
      titleLangKey: 'Signal.RevokeInvite',
      descriptionLangKey: 'Signal.RevokeInviteText',
      button: {langKey: 'Signal.RevokeInvite', isDanger: true}
    }).then(async() => {
      const isRevoked = await managers.appSignalManager.callSignal('revokeChatInvite', {
        chat: {id: toSignalPeerId(chatId.toPeerId(true))},
        serviceId: invite.serviceId
      });
      if(!isRevoked) toastNew({langPackKey: 'Error.AnError'});
      void refetch();
    }, noop);
  };

  const invitedBy = (invite: SignalPendingInvite) => invite.inviterId ?
    i18n('Signal.InvitedBy', [new PeerTitle({peerId: invite.inviterId}).element]) :
    i18n('Signal.InvitedByNumber');

  return (
    <Show when={data()}>
      <Section caption="Signal.PendingInvitesInfo" captionTop noContent={!data().invites.length}>
        <For each={data().invites}>{(invite) => (
          <Row clickable={data().canRevoke ? () => revoke(invite) : undefined}>
            <Show when={invite.userId} fallback={<Row.Icon icon="phone" />}>
              <Row.Media size="abitbigger">
                <AvatarNewTsx peerId={invite.userId} size={42} />
              </Row.Media>
            </Show>
            <Row.Title>
              <Show when={invite.userId} fallback={invite.phoneNumber ?? i18n('Signal.InvitedContact')}>
                <PeerTitleTsx peerId={invite.userId} />
              </Show>
            </Row.Title>
            <Row.Subtitle>{invitedBy(invite)}</Row.Subtitle>
          </Row>
        )}</For>
      </Section>
    </Show>
  );
};

export default PendingInvites;
