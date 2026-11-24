/*
 * TeleSignal: the group link of a Signal group, as Signal Android's group link screen (`ShareableGroupLinkFragment`)
 * and Web A's `ManageInvites` show it. A Signal group has one link, which is on or off; resetting it makes the
 * earlier link stop working, and admin approval makes joining by it a request.
 */

import {Component, createSignal, Show} from 'solid-js';
import {i18n} from '@lib/langPack';
import confirmationPopup from '@components/confirmationPopup';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import showLinkQrCodePopup from '@components/popups/linkQrCode';
import Row from '@components/rowTsx';
import Section from '@components/section';
import {InviteLink} from '@components/sidebarLeft/tabs/inviteLink';
import toastError from '@components/toastError';
import {ChatInvite} from './chatInviteLinkShared';
import {useSuperTab} from '@components/solidJsTabs/superTabProvider';
import {usePromiseCollector} from '@components/solidJsTabs/promiseCollector';
import type {AppChatInviteLinksTab} from '@components/solidJsTabs/tabs';
import {MessagesExportedChatInvite} from '@layer';

const ChatInviteLinks: Component = () => {
  const [tab] = useSuperTab<typeof AppChatInviteLinksTab>();
  const promiseCollector = usePromiseCollector();
  const {chatId} = tab.payload;
  const {appChatInvitesManager} = tab.managers;

  // * the link while it is on
  const [invite, setInvite] = createSignal<ChatInvite>();
  const [isBusy, setIsBusy] = createSignal(false);
  // * the toggles, set back when a change is refused
  const [isOn, setIsOn] = createSignal(false);
  const [isApprovalRequired, setIsApprovalRequired] = createSignal(false);

  const inviteLink = new InviteLink({
    buttons: [{
      icon: 'copy',
      text: 'CopyLink',
      onClick: () => inviteLink.copyLink()
    }, {
      icon: 'qr',
      text: 'Signal.GroupLink.QrCode',
      onClick: () => showLinkQrCodePopup({url: inviteLink.url, aboutLangKey: 'Signal.GroupLink.QrAbout'})
    }],
    listenerSetter: tab.listenerSetter
  });

  const showInvite = (newInvite: ChatInvite | undefined) => {
    setInvite(newInvite);
    setIsOn(!!newInvite);
    setIsApprovalRequired(!!newInvite?.pFlags.request_needed);
    if(newInvite) inviteLink.setUrl(newInvite.link);
  };

  /** Runs a change of the link, one at a time; the adapter shows why the provider refused one */
  const change = async(callback: () => Promise<ChatInvite | undefined>) => {
    setIsBusy(true);
    try {
      showInvite(await callback());
    } catch(err) {
      showInvite(invite());
      toastError(err as ApiError, 'group link change error');
    } finally {
      setIsBusy(false);
    }
  };

  const toggleLink = (isEnabled: boolean) => change(async() => {
    if(isEnabled) {
      return await appChatInvitesManager.exportChatInvite({chatId}) as ChatInvite;
    }

    await appChatInvitesManager.deleteExportedChatInvite(chatId, invite().link);
    return undefined;
  });

  const toggleApproval = (isRequestNeeded: boolean) => change(async() => {
    const result = await appChatInvitesManager.editExportedChatInvite({
      chatId,
      link: invite().link,
      requestNeeded: isRequestNeeded
    });
    return result.invite as ChatInvite;
  });

  const resetLink = async() => {
    await confirmationPopup({
      titleLangKey: 'Signal.GroupLink.Reset',
      descriptionLangKey: 'Signal.GroupLink.ResetConfirm',
      button: {langKey: 'Signal.GroupLink.Reset', isDanger: true}
    });

    await change(async() => {
      const result = await appChatInvitesManager.editExportedChatInvite({chatId, link: invite().link, revoked: true});
      return (result as MessagesExportedChatInvite.messagesExportedChatInviteReplaced).new_invite as ChatInvite;
    });
  };

  promiseCollector.collect(appChatInvitesManager.getExportedChatInvites({chatId, limit: 1}).then((result) => {
    showInvite(result.invites[0] as ChatInvite);
  }));

  return (
    <>
      <Section caption="Signal.GroupLink.Info">
        <Row>
          <Row.CheckboxFieldToggle>
            <CheckboxFieldTsx signal={[isOn, setIsOn]} toggle disabled={isBusy()} onChange={toggleLink} />
          </Row.CheckboxFieldToggle>
          <Row.Title>{i18n('Signal.GroupLink.Title')}</Row.Title>
        </Row>
      </Section>
      <Show when={invite()}>
        <Section name="InviteLink">
          {inviteLink.container}
        </Section>
        <Section caption="Signal.GroupLink.ApproveInfo">
          <Row>
            <Row.CheckboxFieldToggle>
              <CheckboxFieldTsx
                signal={[isApprovalRequired, setIsApprovalRequired]}
                toggle
                disabled={isBusy()}
                onChange={toggleApproval}
              />
            </Row.CheckboxFieldToggle>
            <Row.Title>{i18n('Signal.GroupLink.Approve')}</Row.Title>
          </Row>
          <Row color="danger" clickable={() => void resetLink().catch(() => {})} disabled={isBusy()}>
            <Row.Icon icon="replace" />
            <Row.Title class="danger">{i18n('Signal.GroupLink.Reset')}</Row.Title>
          </Row>
        </Section>
      </Show>
    </>
  );
};

export default ChatInviteLinks;
