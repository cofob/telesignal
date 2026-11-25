import type ChatTopbar from '@components/chat/topbar';
import Chat from '@components/chat/chat';
import {ChatType} from '@components/chat/chatType';
import {LangPackKey, i18n} from '@lib/langPack';
import {PeerSettings} from '@layer';
import {AppManagers} from '@lib/managers';
import apiManagerProxy from '@lib/apiManagerProxy';
import rootScope from '@lib/rootScope';
import callbackify from '@helpers/callbackify';
import confirmationPopup from '@components/confirmationPopup';
import classNames from '@helpers/string/classNames';
import ListenerSetter from '@helpers/listenerSetter';
import Icon from '@components/icon';
import PeerTitle from '@components/peerTitle';
import wrapPeerTitle from '@components/wrappers/peerTitle';
import showPeerPopup from '@components/popups/peer';
import {toastNew} from '@components/toast';
import formatUserPhone from '@components/wrappers/formatUserPhone';
import {formatFullSentTime} from '@helpers/date';
import wrapEmojiText from '@lib/richTextProcessor/wrapEmojiText';
import createMiddleware from '@helpers/solid/createMiddleware';
import setInnerHTML from '@helpers/dom/setInnerHTML';
import {AckedResult} from '@lib/superMessagePort';
import {Accessor, createSignal, For, Show} from 'solid-js';
import TopbarPlate, {createTopbarPlate, TopbarPlateController} from '@components/chat/topbarPlate';
import {hotListen} from '@helpers/hotModule';
import noop from '@helpers/noop';

type PeerSettingsKey = keyof PeerSettings['pFlags'];

/**
 * `reopen_topic` is not a peer setting — it mirrors the sibling bar tdesktop stacks next to the contact status
 * one (`TopicReopenBar`, `history_view_contact_status.cpp`).
 */
type ActionKey = PeerSettingsKey | 'reopen_topic' | MessageRequestActionKey;

/**
 * TeleSignal: the answers to a Signal message request, as Web A's `ChatReportPane` offers them. Signal's peer
 * settings are only message requests (`lib/signal/chatMethods.ts`), and `block_contact` marks one.
 */
type MessageRequestActionKey = 'request_accept' | 'request_delete' | 'request_block' | 'request_report';

type ActionDef = {
  key: ActionKey,
  onClick: () => void,
  danger?: boolean,
  icon?: Icon,
  /** Reads as a prompt rather than a command, so it keeps its own casing. */
  keepCase?: boolean
};

type PeerSettingsActionDef = ActionDef & {key: PeerSettingsKey};

/** The badge next to an unknown sender's name, when it is worth explaining. */

/**
 * The `request_chat_*` peer settings, which describe the join request that made this
 * stranger able to write to us. Rendered as a tappable info line instead of buttons.
 */
type RequestChatInfo = {
  peerId: PeerId,
  title: string,
  date: number,
  isBroadcast: boolean
};

const LANG_KEY_MAP: {[key in ActionKey]?: LangPackKey} = {
  add_contact: 'AddContact',
  autoarchived: 'Unarchive',
  block_contact: 'BlockUser',
  share_contact: 'ShareMyPhoneNoCaps',
  reopen_topic: 'RestartTopic',
  request_accept: 'Signal.MessageRequest.Accept',
  request_delete: 'Signal.MessageRequest.Delete',
  request_block: 'Signal.MessageRequest.Block',
  request_report: 'Signal.MessageRequest.Report'
};

/** The message requests whose bar the cross hid on this tab: the cross does not answer the request */
const messageRequestBarHidden = new Set<PeerId>();
hotListen(import.meta.hot, rootScope, 'account_switched', () => {
  messageRequestBarHidden.clear();
});

export type ChatActionsPlate = TopbarPlateController & {
  set: (peerId: PeerId, settings: PeerSettings) => () => void,
  unset: (peerId: PeerId) => void,
  setPeerId: (peerId: PeerId) => Promise<AckedResult<() => void>>
};

function ActionsPlateBody(props: {
  buttons: Accessor<ActionDef[] | undefined>,
  requestChat: Accessor<RequestChatInfo | undefined>,
  canClose: Accessor<boolean>,
  onClose: () => void,
  onRequestChatClick: (info: RequestChatInfo) => void
}) {
  return (
    <Show
      // keyed: the line is built imperatively, so a switch straight from one
      // request-chat peer to another has to rebuild it rather than keep the old title
      keyed
      when={props.requestChat()}
      fallback={
        <>
          <div class="pinned-actions-row">
            <Show when={props.buttons()}>
              {(btns) => (
                <For each={btns()}>
                  {(action) => (
                    <TopbarPlate.PrimaryButton
                      danger={action.danger}
                      onClick={action.onClick}
                    >
                      {action.icon && Icon(action.icon, 'pinned-actions-primary-button-icon')}
                      {(() => {
                        const text = i18n(LANG_KEY_MAP[action.key]);
                        text.classList.add(
                          'pinned-actions-primary-button-text',
                          'text-overflow-no-wrap',
                          ...(action.keepCase ? [] : ['text-uppercase'])
                        );
                        return text;
                      })()}
                    </TopbarPlate.PrimaryButton>
                  )}
                </For>
              )}
            </Show>
            {/* Nothing to dismiss when the plate only carries the topic-reopen action —
                tdesktop's reopen bar has no close button either. */}
            <Show when={props.canClose()}>
              <TopbarPlate.CloseButton onClick={props.onClose} />
            </Show>
          </div>
        </>
      }
    >
      {(info) => {
        const peerTitle = new PeerTitle();
        peerTitle.update({peerId: info.peerId});

        // * the chat's title is isolated like the name, so neither reorders the sentence around it
        const chatTitle = document.createElement('span');
        setInnerHTML(chatTitle, wrapEmojiText(info.title));

        return (
          <TopbarPlate.PrimaryButton
            quiet
            class="pinned-actions-info rp-overflow"
            onClick={() => props.onRequestChatClick(info)}
          >
            {i18n(
              info.isBroadcast ? 'ChatWithChannelAdmin' : 'ChatWithGroupAdmin',
              [peerTitle.element, chatTitle]
            )}
          </TopbarPlate.PrimaryButton>
        );
      }}
    </Show>
  );
}

export default function createChatActionsPlate(
  topbar: ChatTopbar,
  chat: Chat,
  managers: AppManagers,
  peerSettingsConsumer?: Pick<ChatActionsPlate, 'set' | 'unset'>
): ChatActionsPlate {
  const [buttons, setButtons] = createSignal<ActionDef[] | undefined>();
  const [requestChat, setRequestChat] = createSignal<RequestChatInfo | undefined>();
  const [canClose, setCanClose] = createSignal(false);
  const [disabled, setDisabled] = createSignal(false);

  let currentPeerId: PeerId | undefined;
  let currentThreadId: number | undefined;
  let currentSettings: PeerSettings | undefined;
  let peerSettingsActions: ActionDef[] = [];
  let isMessageRequest = false;
  let requestChatInfo: RequestChatInfo | undefined;
  let canReopenTopic = false;

  const freeze = async(promise: Promise<any>) => {
    setDisabled(true);
    try {
      await promise;
    } catch(err) {

    }
    setDisabled(false);
  };

  const actions: PeerSettingsActionDef[] = [{
    key: 'autoarchived',
    onClick: () => {
      freeze(managers.appProfileManager.unarchiveFromSettingsBar(currentPeerId));
    }
  }, {
    key: 'block_contact',
    onClick: () => {
      topbar.blockUser(false, true, (promise) => freeze(promise));
    },
    danger: true
  }, {
    key: 'add_contact',
    onClick: () => topbar.addContact()
  }, {
    key: 'share_contact',
    onClick: async() => {
      const peerId = currentPeerId;
      const userId = peerId.toUserId();
      const myPhone = apiManagerProxy.getUser(rootScope.myId.toUserId())?.phone;
      await confirmationPopup({
        titleLangKey: 'ShareYouPhoneNumberTitle',
        descriptionLangKey: 'AreYouSureShareMyContactInfoUser',
        descriptionLangArgs: [
          myPhone ? formatUserPhone(myPhone) : '',
          await wrapPeerTitle({peerId})
        ],
        button: {langKey: 'OK'}
      });

      const promise = managers.appUsersManager.acceptContact(userId).then(() => {
        toastNew({
          langPackKey: 'Conversation.ShareMyPhoneNumber.StatusSuccess',
          langPackArguments: [new PeerTitle({peerId, onlyFirstName: true}).element]
        });
      });
      freeze(promise);
    }
  }];

  /** The answer to a message request; the bar goes once the provider has sent it, and stays when it could not */
  const respondToMessageRequest = (promise: Promise<unknown>) => freeze(promise.catch((err: ApiError) => {
    // * a failure that the provider reported is shown already
    if(err?.type !== 'MIDDLEWARE' && !err?.handled) toastNew({langPackKey: 'Signal.Error.RequestResponseFailed'});
  }));

  const messageRequestActions: ActionDef[] = [{
    key: 'request_accept',
    onClick: () => {
      respondToMessageRequest(managers.appProfileManager.hidePeerSettingsBar(currentPeerId));
    }
  }, {
    key: 'request_delete',
    onClick: () => {
      const peerId = currentPeerId;
      confirmationPopup({
        titleLangKey: 'Signal.MessageRequest.DeleteTitle',
        descriptionLangKey: 'Signal.MessageRequest.DeleteText',
        button: {langKey: 'Signal.MessageRequest.Delete', isDanger: true}
      }).then(() => {
        respondToMessageRequest(managers.appMessagesManager.flushHistory({peerId, justClear: false, revoke: true}));
      }, noop);
    },
    danger: true
  }, {
    key: 'request_block',
    onClick: () => {
      const peerId = currentPeerId;
      confirmationPopup({
        titleLangKey: 'Signal.MessageRequest.BlockTitle',
        titleLangArgs: [new PeerTitle({peerId, onlyFirstName: true}).element],
        descriptionLangKey: peerId.isUser() ? 'Signal.MessageRequest.BlockText' : 'Signal.MessageRequest.BlockGroupText',
        button: {langKey: 'Signal.MessageRequest.Block', isDanger: true}
      }).then(() => {
        respondToMessageRequest(managers.appUsersManager.toggleBlock(peerId, true));
      }, noop);
    },
    danger: true
  }, {
    key: 'request_report',
    onClick: () => {
      const peerId = currentPeerId;
      confirmationPopup({
        titleLangKey: 'Signal.MessageRequest.ReportTitle',
        descriptionLangKey: 'Signal.MessageRequest.ReportText',
        checkbox: {text: 'Signal.MessageRequest.ReportAndBlock', checked: true},
        button: {langKey: 'Signal.MessageRequest.Report', isDanger: true}
      }).then((shouldBlock) => {
        // * the report goes first: it names messages of the request
        respondToMessageRequest(managers.appMessagesManager.reportSpam(peerId).then(() => {
          return shouldBlock && managers.appUsersManager.toggleBlock(peerId, true);
        }));
      }, noop);
    },
    danger: true
  }];

  const reopenTopicAction: ActionDef = {
    key: 'reopen_topic',
    onClick: () => {
      freeze(managers.appMessagesManager.editForumTopic({
        peerId: currentPeerId,
        topicId: currentThreadId,
        closed: false
      }));
    }
  };

  const showRequestChatInfoPopup = (info: RequestChatInfo) => {
    showPeerPopup('popup-confirmation', {
      titleLangKey: info.isBroadcast ? 'ChatWithAdminChannelTitle' : 'ChatWithAdminGroupTitle',
      descriptionLangKey: 'ChatWithAdminMessage',
      descriptionLangArgs: [wrapEmojiText(info.title), formatFullSentTime(info.date, true, true)],
      buttons: [{
        // `isCancel` keeps `addCancelButton` from adding a second button — tdesktop's
        // box acknowledges and dismisses with this one.
        langKey: 'IUnderstand',
        isCancel: true,
        callback: () => {
          managers.appProfileManager.hidePeerSettingsBar(info.peerId);
        }
      }]
    });
  };

  const onClose = () => {
    if(isMessageRequest) {
      messageRequestBarHidden.add(currentPeerId);
    } else if(currentPeerId !== undefined) {
      managers.appProfileManager.hidePeerSettingsBar(currentPeerId);
    }

    // Only the peer-settings half is dismissable — a still-closed topic keeps
    // offering the reopen button.
    peerSettingsActions = [];
    applyState();
  };

  const plate = createTopbarPlate({
    modifier: 'actions',
    // 'auto' because the request-chat line wraps; the button rows keep their fixed
    // height through `min-height` in the stylesheet.
    height: 'auto',
    class: () => classNames(
      disabled() && 'is-disabled',
      buttons()?.length > 1 && 'is-multiple',
      buttons()?.length === 1 && !canClose() && 'is-single'
    ),
    onVisibilityChange: () => topbar.setFloating(),
    render: () => (
      <ActionsPlateBody
        buttons={buttons}
        requestChat={requestChat}
        canClose={canClose}
        onClose={onClose}
        onRequestChatClick={showRequestChatInfoPopup}
      />
    )
  });

  const applyState = () => {
    setRequestChat(requestChatInfo);
    if(requestChatInfo) {
      setButtons(undefined);
      setCanClose(false);
      plate.setHidden(false);
    } else {
      const list = canReopenTopic ? [reopenTopicAction, ...peerSettingsActions] : peerSettingsActions;

      // * a message request has its four answers, as Web A shows them
      const visible = isMessageRequest ? list : list.slice(0, 2);
      setButtons(visible.length ? visible : undefined);
      setCanClose(!!peerSettingsActions.length);
      plate.setHidden(!visible.length);
    }

    // The plate measures itself ('auto'), and its content height changes with the mode.
    topbar.setFloating();
  };

  /** A forum topic is the only thread kind that can be closed and reopened. */
  const supportsTopicReopen = (peerId: PeerId, threadId: number) => {
    return !!threadId && !!peerId?.isAnyChat() && chat.type === ChatType.Chat;
  };

  const ackedCanReopenTopic = (peerId: PeerId, threadId: number): Promise<AckedResult<boolean>> => {
    if(!supportsTopicReopen(peerId, threadId)) {
      return Promise.resolve({cached: true, result: Promise.resolve(false)});
    }

    return managers.acknowledged.dialogsStorage.canReopenTopic(peerId, threadId);
  };

  const refreshCanReopenTopic = async() => {
    const peerId = currentPeerId, threadId = currentThreadId;
    if(!supportsTopicReopen(peerId, threadId)) {
      return;
    }

    const value = await managers.dialogsStorage.canReopenTopic(peerId, threadId);
    if(currentPeerId !== peerId || currentThreadId !== threadId || canReopenTopic === value) {
      return;
    }

    canReopenTopic = value;
    applyState();
  };

  /**
   * tdesktop's `ContactStatus::PeerState` is a priority chain, not a flat filter: a
   * contact only ever gets the share-phone bar, and the join-request line takes the
   * whole bar from everything below it.
   */
  const recomputePeerSettings = () => {
    const settings = currentSettings;
    const pFlags = settings?.pFlags;
    peerSettingsActions = [];
    requestChatInfo = undefined;
    isMessageRequest = false;
    if(!pFlags) {
      return;
    }

    if(pFlags.block_contact) {
      if(!messageRequestBarHidden.has(currentPeerId)) {
        isMessageRequest = true;
        peerSettingsActions = currentPeerId.isUser() ?
          messageRequestActions :
          messageRequestActions.filter((action) => action.key !== 'request_report');
      }

      return;
    }

    const isUser = currentPeerId.isUser();
    if(isUser && apiManagerProxy.getUser(currentPeerId.toUserId())?.pFlags?.contact) {
      if(pFlags.share_contact) {
        peerSettingsActions = actions.filter((action) => action.key === 'share_contact');
      }

      return;
    }

    if(isUser && settings.request_chat_title !== undefined) {
      requestChatInfo = {
        peerId: currentPeerId,
        title: settings.request_chat_title,
        date: settings.request_chat_date,
        isBroadcast: !!pFlags.request_chat_broadcast
      };
      return;
    }

    peerSettingsActions = actions.filter((action) => {
      return action.key !== 'share_contact' && pFlags[action.key];
    });
  };

  const listenerSetter = new ListenerSetter();

  // The topic's `closed` flag arrives as a `messageActionTopicEdit` service message.
  listenerSetter.add(rootScope)('dialogs_multiupdate', (dialogs) => {
    if(!currentThreadId || !dialogs.get(currentPeerId)?.topics?.has(currentThreadId)) {
      return;
    }

    refreshCanReopenTopic();
  });

  // ...and the rights that let us reopen it can change under us (tdesktop watches
  // `adminRightsValue` for the same reason).
  listenerSetter.add(rootScope)('chat_update', (chatId) => {
    if(!currentThreadId || currentPeerId !== chatId.toPeerId(true)) {
      return;
    }

    refreshCanReopenTopic();
  });

  // Becoming a contact swaps the whole branch of the chain (tdesktop watches the
  // `Contact` user flag).
  listenerSetter.add(rootScope)('contacts_update', (userId) => {
    if(currentPeerId !== userId.toPeerId(false)) {
      return;
    }

    recomputePeerSettings();
    applyState();
  });

  const unsetOwn = (peerId: PeerId) => {
    currentPeerId = peerId;
    currentThreadId = undefined;
    currentSettings = undefined;
    peerSettingsActions = [];
    requestChatInfo = undefined;
    canReopenTopic = false;
    applyState();
  };

  const unset = (peerId: PeerId) => {
    unsetOwn(peerId);
    peerSettingsConsumer?.unset(peerId);
  };

  const set = (peerId: PeerId, settings: PeerSettings) => {
    const peerSettingsCallback = peerSettingsConsumer?.set(peerId, settings);

    return () => {
      currentPeerId = peerId;
      currentSettings = settings;
      recomputePeerSettings();
      chat.bubbles.setPeerSettings(peerId, settings);

      applyState();
      peerSettingsCallback?.();
    };
  };

  const setPeerId = (peerId: PeerId) => {
    const threadId = chat.threadId;
    return Promise.all([
      managers.acknowledged.appProfileManager.getPeerSettings(peerId),
      ackedCanReopenTopic(peerId, threadId)
    ]).then(([peerSettingsAcked, canReopenAcked]) => {
      return {
        cached: peerSettingsAcked.cached && canReopenAcked.cached,
        result: callbackify(
          Promise.all([peerSettingsAcked.result, canReopenAcked.result]),
          ([peerSettings, canReopen]) => {
            const setPeerSettings = set(peerId, peerSettings);
            return () => {
              currentThreadId = threadId;
              canReopenTopic = canReopen;
              setPeerSettings();
            };
          }
        )
      };
    });
  };

  return {
    ...plate,
    destroy: () => {
      listenerSetter.removeAll();
      plate.destroy();
    },
    set,
    unset,
    setPeerId
  };
}
