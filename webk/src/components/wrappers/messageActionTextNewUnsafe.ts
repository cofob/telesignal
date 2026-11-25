import indexOfAndSplice from '@helpers/array/indexOfAndSplice';
import {formatTime, ONE_DAY} from '@helpers/date';
import htmlToSpan from '@helpers/dom/htmlToSpan';
import setInnerHTML, {setDirection} from '@helpers/dom/setInnerHTML';
import {wrapCallDuration} from '@components/wrappers/wrapDuration';
import paymentsWrapCurrencyAmount from '@helpers/paymentsWrapCurrencyAmount';
import {Message, MessageAction, MessageEntity, MessageMedia, MessageReplyHeader, StarGift, TextWithEntities} from '@layer';
import getPeerId from '@appManagers/utils/peers/getPeerId';
import I18n, {FormatterArgument, FormatterArguments, i18n, join, langPack, LangPackKey, UNSUPPORTED_LANG_PACK_KEY, _i18n} from '@lib/langPack';
import {decodeSignalNotice} from '@lib/signal/notices';
import {SERVICE_PEER_ID} from '@appManagers/constants';
import wrapEmojiText from '@lib/richTextProcessor/wrapEmojiText';
import tsNow from '@helpers/tsNow';
import wrapPlainText from '@lib/richTextProcessor/wrapPlainText';
import wrapRichText from '@lib/richTextProcessor/wrapRichText';
import rootScope from '@lib/rootScope';
import isOwnMessage from '@appManagers/utils/messages/isOwnMessage';
import getPeerTitle from '@components/wrappers/getPeerTitle';
import wrapJoinVoiceChatAnchor from '@components/wrappers/joinVoiceChatAnchor';
import {getConferenceCallLangKey, getConferenceCallState} from '@lib/calls/helpers/conferenceCallAction';
import {WrapMessageActionTextOptions} from '@components/wrappers/messageActionTextNew';
import wrapMessageForReply, {WrapMessageForReplyOptions} from '@components/wrappers/messageForReply';
import wrapPeerTitle from '@components/wrappers/peerTitle';
import shouldDisplayGiftCodeAsGift from '@helpers/shouldDisplayGiftCodeAsGift';
import Icon from '@components/icon';
import {getPriceChangedActionMessageLangParams, getStarGiftActionLangParams} from '@lib/lang';
import {numberThousandSplitterForStars} from '@helpers/number/numberThousandSplitter';
import {getCollectibleName} from '@appManagers/utils/gifts/getCollectibleName';
import {truncateTextWithEntities} from '@lib/richTextProcessor/truncateTextWithEntities';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';

async function wrapLinkToMessage(options: WrapMessageForReplyOptions) {
  const wrapped = await wrapMessageForReply(options);

  if(options.plain) {
    return wrapped;
  }

  const a = document.createElement('i');
  a.dataset.savedFrom = (options.message as Message.message).peerId + '_' + (options.message as Message.message).mid;
  a.append(wrapped);
  setDirection(a);
  return a;
}

function wrapSomeText(text: string, plain: boolean, entities?: MessageEntity[]) {
  return plain ? text : htmlToSpan(wrapEmojiText(text, false, entities));
}

function joinTexts(texts: (string | HTMLElement)[], params: {
  delimiter: string,
  wrap?: (text: string | HTMLElement) => string | HTMLElement,
  prepend?: string,
  append?: string
}) {
  const {delimiter, prepend, append} = params
  const fragment = document.createDocumentFragment()
  let first = true
  for(const it of texts) {
    if(first) {
      first = false
    } else {
      fragment.append(delimiter)
    }

    if(prepend) {
      fragment.append(prepend)
    }
    if(params.wrap) {
      fragment.append(params.wrap(it));
    } else {
      fragment.append(it);
    }
    if(append) {
      fragment.append(append)
    }
  }
  return fragment
}

const TODO_JOIN_OPTIONS: Parameters<typeof joinTexts>[1] = {
  delimiter: ', ',
  prepend: '"',
  append: '"',
  wrap: el => {
    const b = document.createElement('b');
    b.append(el);
    return b;
  }
};

const MAX_ANSWER_TEXT_LENGTH = 20;

// * TeleSignal: the TON wallet's and the forum topics' service actions, which Signal has no counterpart for, show as
// * unsupported
const UNSUPPORTED_ACTIONS = new Set<string>([
  'messageActionTopicCreate',
  'messageActionTopicEdit',
  'messageActionGramTransfer',
  'messageActionWalletTonConnectRequest',
  'messageActionChatJoinedViaCommunity',
  'messageActionChangeCommunity'
]);

export function wrapMessageGiveawayResults(action: MessageAction.messageActionGiveawayResults | MessageMedia.messageMediaGiveawayResults, plain?: boolean) {
  let langPackKey: LangPackKey = 'Giveaway.Results';
  let args: FormatterArguments = [action.winners_count];

  const setCombined = (addLangPackKey: LangPackKey, addArgs?: FormatterArguments) => {
    args = [
      plain ?
        I18n.format(langPackKey, true, args as FormatterArguments) :
        i18n(langPackKey, args as FormatterArguments)
    ];

    langPackKey = 'Giveaway.Results.Combined';
    args.push(
      plain ?
        I18n.format(addLangPackKey, true, addArgs) :
        i18n(addLangPackKey, addArgs)
    );
  };

  if(!action.winners_count) {
    langPackKey = (action as MessageAction.messageActionGiveawayResults).pFlags.stars ? 'Giveaway.Results.NoWinners.Stars' : 'Giveaway.Results.NoWinners';
    args = [action.unclaimed_count];
  } else if(action.unclaimed_count) {
    setCombined('Giveaway.Results.Unclaimed', [action.unclaimed_count]);
  }

  return {langPackKey, args};
}

export default async function wrapMessageActionTextNewUnsafe(options: WrapMessageActionTextOptions) {
  const {plain, message, noLinks} = options;
  const element: HTMLElement = plain ? undefined : document.createElement('span');
  const action = 'action' in message && message.action;

  // this.log('message action:', action);

  // * TeleSignal: a notice of Signal, as a lang key and its arguments (`@lib/signal/notices`)
  const signalNotice = action._ === 'messageActionCustomAction' && action.message && decodeSignalNotice(action.message);
  if(signalNotice) {
    // * a key this build does not have (a newer adapter's), its own or an argument's, reads as an unsupported notice
    const hasKey = (key: string) => I18n.strings.has(key as LangPackKey);
    const argKeys = (signalNotice.args ?? []).filter((arg) => typeof(arg) === 'object').map((arg) => (arg as {key: string}).key);
    const isKnown = hasKey(signalNotice.key) && argKeys.every(hasKey);
    const args = isKnown ? (signalNotice.args ?? []).map((arg) => typeof(arg) === 'object' ? I18n.format(arg.key as LangPackKey, true) : arg) : [];
    const text = I18n.format((isKnown ? signalNotice.key : 'Signal.Notice.Unsupported') as LangPackKey, true, args);
    if(plain) return text;
    element.textContent = text;
    return element;
  }

  if(action._ === 'messageActionCustomAction' && action.message) {
    const unsafeMessage = action.message;
    if(plain) {
      return wrapPlainText(unsafeMessage);
    } else {
      setInnerHTML(element, wrapRichText(unsafeMessage, {noLinebreaks: true}));
      return element;
    }
  } else {
    let _ = action._;
    // let suffix = '';
    let langPackKey: LangPackKey;
    let icon: HTMLElement | undefined;
    let args: Array<FormatterArgument | Promise<FormatterArgument>>;

    const managers = bindManagersToSession(rootScope.managers);

    const getNameDivHTML = (peerId: PeerId, plain: boolean, onlyFirstName?: boolean) => {
      // a name in a service message opens its peer on click (onBubblesClick): a link to it
      return plain ? getPeerTitle({peerId, plainText: plain, onlyFirstName}) : wrapPeerTitle({peerId, link: !noLinks, onlyFirstName});
    };

    const wrapTruncatedText = (text: string, entities: MessageEntity[] | undefined, maxLength: number) => {
      const truncated = truncateTextWithEntities(text, entities, maxLength);

      if(plain) {
        return wrapPlainText(truncated.text, truncated.entities);
      } else {
        return htmlToSpan(wrapEmojiText(truncated.text, false, truncated.entities));
      }
    };

    const getSeveralNameDivHTML = async(peerIds: PeerId[], plain: boolean) => {
      if(peerIds.length === 1) {
        return getNameDivHTML(peerIds[0], plain);
      }

      const joined = join(
        await Promise.all(peerIds.map((peerId) => getNameDivHTML(peerId, plain))),
        false,
        plain
      );

      if(plain) {
        return Array.isArray(joined) ? joined.join('') : joined;
      } else {
        const fragment = document.createElement('span');
        fragment.append(...joined);
        args.push(fragment);
        return fragment;
      }
    };

    switch(action._) {
      case 'messageActionPhoneCall': {
        _ += '.' + (action as any).type;

        args = [wrapCallDuration(action.duration, plain)];
        break;
      }

      case 'messageActionGroupCall': {
        _ += '.' + (action as any).type;

        args = [];
        if(!_.endsWith('You') && !message.pFlags.post) {
          args.push(getNameDivHTML(message.fromId, plain));
        }

        if(action.duration !== undefined) {
          args.push(wrapCallDuration(action.duration, plain));
        } else if(noLinks) {
          args.push('');
        } else {
          args.push(wrapJoinVoiceChatAnchor(message as any));
        }

        break;
      }

      case 'messageActionInviteToGroupCall': {
        const peerIds = [message.fromId, action.users[0].toPeerId()];
        let a = 'Chat.Service.VoiceChatInvitation';
        const myId = rootScope.myId;
        if(peerIds[0] === myId) a += 'ByYou';
        else if(peerIds[1] === myId) a += 'ForYou';
        indexOfAndSplice(peerIds, myId);

        langPackKey = a as LangPackKey;
        args = peerIds.map((peerId) => getNameDivHTML(peerId, plain));
        args.push(noLinks ? '' : wrapJoinVoiceChatAnchor(message as any));
        break;
      }

      case 'messageActionConferenceCall': {
        // Same title tdesktop's `MediaCall::Text` produces for the call bubble
        // (rendered by `wrapCallBubble`) — here it serves the plain-text uses:
        // chat list previews, replies, notifications, and the fallback for
        // browsers that render the action as a service message because they
        // cannot join a group call at all.
        langPackKey = getConferenceCallLangKey(
          getConferenceCallState(action),
          !!message.pFlags.out
        );
        args = [];
        break;
      }

      case 'messageActionGroupCallScheduled': {
        const today = new Date();
        const date = new Date(action.schedule_date * 1000);
        const daysToStart = (date.getTime() - today.getTime()) / 86400e3;
        const tomorrowDate = new Date(today);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);

        const isBroadcast = await managers.appPeersManager.isBroadcast(message.peerId);
        langPackKey = isBroadcast ? 'ChatList.Service.VoiceChatScheduled.Channel' : 'ChatList.Service.VoiceChatScheduled';
        args = [];
        const myId = rootScope.myId;
        if(message.fromId === myId) {
          langPackKey += 'You';
        } else if(!isBroadcast) {
          args.push(getNameDivHTML(message.fromId, plain));
        }

        let k: LangPackKey;
        const _args: FormatterArguments = [];
        if(daysToStart < 1 && date.getDate() === today.getDate()) {
          k = 'TodayAtFormattedWithToday';
        } else if(daysToStart < 2 && date.getDate() === tomorrowDate.getDate()) {
          k = 'Time.TomorrowAt';
        } else {
          k = 'formatDateAtTime';
          _args.push(new I18n.IntlDateElement({
            date,
            options: {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit'
            }
          }).element);
        }

        _args.push(formatTime(date));
        const t = i18n(k, _args);
        args.push(t);

        break;
      }

      case 'messageActionChatCreate': {
        const myId = rootScope.myId;
        if(message.fromId === myId) {
          _ += 'You';
        } else {
          args = [getNameDivHTML(message.fromId, plain)];
        }

        break;
      }

      case 'messageActionGameScore': {
        const fromMe = message.fromId === rootScope.myId;
        args = [];
        if(!fromMe) {
          args.push(getNameDivHTML(message.fromId, plain));
        }
        args.push('' + action.score);

        let gameTitle: string | undefined;
        if(message.reply_to_mid) {
          const gameMessage = await managers.appMessagesManager.getMessageByPeer(message.peerId, message.reply_to_mid);
          const media = (gameMessage as Message.message)?.media;
          if(media?._ === 'messageMediaGame' && media.game?._ === 'game') {
            gameTitle = media.game.title;
          } else if(!gameMessage) {
            managers.appMessagesManager.fetchMessageReplyTo(message);
          }
        }

        if(gameTitle) {
          if(plain) {
            args.push(wrapSomeText(gameTitle, plain));
          } else {
            const link = document.createElement('i');
            link.classList.add('is-game-link');
            link.dataset.savedFrom = message.peerId + '_' + message.reply_to_mid;
            link.append(wrapSomeText(gameTitle, false));
            setDirection(link);
            args.push(link);
          }
          langPackKey = fromMe ? 'ActionYouScoredInGame' : 'ActionUserScoredInGame';
        } else {
          langPackKey = fromMe ? 'ActionYouScored' : 'ActionUserScored';
        }
        break;
      }

      case 'messageActionPinMessage': {
        const peerId = message.peerId;
        const pinnedMessage = await managers.appMessagesManager.getMessageByPeer(peerId, message.reply_to_mid);

        args = [
          getNameDivHTML(message.fromId, plain)
        ];

        if(!pinnedMessage/*  || true */) {
          langPackKey = 'ActionPinnedNoText';

          if(message.reply_to_mid) { // refresh original message
            managers.appMessagesManager.fetchMessageReplyTo(message);
          }
        } else {
          args.push(wrapLinkToMessage({
            ...options,
            message: pinnedMessage
          }));
        }

        break;
      }

      case 'messageActionChatJoinedByRequest': {
        const isBroadcast = await managers.appPeersManager.isBroadcast(message.peerId);
        if(message.pFlags.out) {
          langPackKey = isBroadcast ? 'RequestToJoinChannelApproved' : 'RequestToJoinGroupApproved';
        } else {
          langPackKey = isBroadcast ? 'ChatService.UserJoinedChannelByRequest' : 'ChatService.UserJoinedGroupByRequest';
          args = [getNameDivHTML(message.fromId, plain)];
        }
        break;
      }

      case 'messageActionGiveawayLaunch': {
        langPackKey = action.stars ? 'BoostingStarsGiveawayJustStarted' : 'BoostingGiveawayJustStarted';
        args = [getNameDivHTML(message.fromId, plain)];

        if(action.stars) {
          args.unshift(+action.stars);
        }
        break;
      }

      case 'messageActionContactSignUp':
      case 'messageActionChatReturn':
      case 'messageActionChatLeave':
      case 'messageActionChatJoined':
      case 'messageActionChatEditPhoto':
      case 'messageActionChatDeletePhoto':
      case 'messageActionChatEditVideo':
      case 'messageActionChatJoinedByLink':
      case 'messageActionChannelEditVideo':
      case 'messageActionChannelDeletePhoto': {
        args = [getNameDivHTML(message.fromId, plain)];
        break;
      }

      case 'messageActionSuggestProfilePhoto': {
        const isOutgoing = message.fromId === rootScope.myId;
        langPackKey = isOutgoing ?
          'Action.YouSuggestedProfilePhoto' :
          'Action.SuggestedProfilePhoto';
        args = isOutgoing ? [getNameDivHTML(message.peerId, plain)] : [getNameDivHTML(message.fromId, plain)];
        break;
      }

      case 'messageActionChannelEditTitle':
      case 'messageActionChatEditTitle': {
        args = [];
        if(action._ === 'messageActionChatEditTitle') {
          args.push(getNameDivHTML(message.fromId, plain));
        }

        args.push(wrapSomeText(action.title, plain));
        break;
      }

      case 'messageActionChatDeleteUser':
      case 'messageActionChatAddUsers':
      case 'messageActionChatAddUser': {
        const users = (action as MessageAction.messageActionChatAddUser).users ||
          [(action as MessageAction.messageActionChatDeleteUser).user_id];

        args = [getNameDivHTML(message.fromId, plain)];

        const peerIds = users.map((userId) => userId.toPeerId(false));
        args.push(getSeveralNameDivHTML(peerIds, plain));
        break;
      }

      case 'messageActionBotAllowed': {
        if(action.pFlags?.attach_menu) {
          langPackKey = 'ActionAttachMenuBotAllowed';
          break;
        } else if(action.pFlags?.from_request) {
          langPackKey = 'ActionBotAllowedRequest';
          break;
        } else if(!action.domain) {
          break;
        }

        const anchorHTML = wrapRichText(action.domain, {
          entities: [{
            _: 'messageEntityUrl',
            length: action.domain.length,
            offset: 0
          }],
          noLinks
        });

        const node = htmlToSpan(anchorHTML);

        args = [node];
        break;
      }

      case 'messageActionPaymentSent': {
        const isRecurringInit = action.pFlags.recurring_init;
        const isRecurringUsed = action.pFlags.recurring_used;
        langPackKey = isRecurringUsed ? 'Chat.Service.PaymentSentRecurringUsedNoTitle' : (isRecurringInit ? 'Chat.Service.PaymentSentRecurringInitNoTitle' : 'Chat.Service.PaymentSent1NoTitle');
        const price = paymentsWrapCurrencyAmount(action.total_amount, action.currency, undefined, undefined, plain);
        args = [price, getNameDivHTML(message.peerId, plain)];

        if(message.reply_to_mid) {
          const replyTo = message.reply_to as MessageReplyHeader.messageReplyHeader;
          const invoiceMessage = await managers.appMessagesManager.getMessageByPeer(
            replyTo?.reply_to_peer_id ? getPeerId(replyTo.reply_to_peer_id) : message.peerId,
            message.reply_to_mid
          );

          if(!invoiceMessage) {
            managers.appMessagesManager.fetchMessageReplyTo(message);
          } else {
            langPackKey = isRecurringUsed ? 'Chat.Service.PaymentSentRecurringUsed' : (isRecurringInit ? 'Chat.Service.PaymentSentRecurringInit' : 'Chat.Service.PaymentSent1');
            args.push(wrapLinkToMessage({
              ...options,
              message: invoiceMessage
            }).then((el) => {
              if(el instanceof HTMLElement) {
                el.classList.add('is-receipt-link');
              }

              return el;
            }));
          }
        }

        break;
      }

      case 'messageActionPaymentRefunded': {
        const price = paymentsWrapCurrencyAmount(action.total_amount, action.currency, undefined, undefined, plain);
        args = [getNameDivHTML(message.fromId, plain), price];
        langPackKey = 'Chat.Service.Refund';
        break;
      }

      case 'messageActionSetMessagesTTL': {
        args = [];

        const isBroadcast = await managers.appPeersManager.isBroadcast(message.peerId);
        if(action.period) {
          if(isBroadcast) {
            langPackKey = 'ActionTTLChannelChanged';
          } else if(message.fromId === rootScope.myId) {
            langPackKey = 'ActionTTLYouChanged';
          } else {
            langPackKey = 'ActionTTLChanged';
            args.push(await getNameDivHTML(message.fromId, plain));
          }

          let duration: ReturnType<typeof wrapCallDuration>;
          if(action.period > 1814400) {
            let key: LangPackKey;
            const args: FormatterArguments = [];
            const year = 31536000;
            if(action.period >= year) {
              key = 'Years';
              args.push(action.period / year | 0);
            } else {
              key = 'Months';
              args.push(action.period / (ONE_DAY * 30) | 0);
            }

            duration = plain ? I18n.format(key, true, args) : i18n(key, args);
          } else {
            duration = wrapCallDuration(action.period, plain);
          }

          args.push(duration);
        } else {
          if(isBroadcast) {
            langPackKey = 'ActionTTLChannelDisabled';
          } else if(message.fromId === rootScope.myId) {
            langPackKey = 'ActionTTLYouDisabled';
          } else {
            langPackKey = 'ActionTTLDisabled';
            args.push(getNameDivHTML(message.fromId, plain));
          }
        }
        break;
      }

      case 'messageActionSetChatTheme': {
        const isMe = isOwnMessage(message, rootScope.myId);
        let authorElement: ReturnType<typeof getNameDivHTML>;
        if(!isMe) {
          authorElement = getNameDivHTML(message.fromId, plain);
        }

        args = authorElement ? [authorElement] : [];

        const theme = action.theme;
        if(theme._ === 'chatTheme' && theme.emoticon) {
          args.push(wrapSomeText(theme.emoticon, plain));
          langPackKey = isMe ? 'ChatThemeChangedYou' : 'ChatThemeChangedTo';
        } else {
          langPackKey = isMe ? 'ChatThemeDisabledYou' : 'ChatThemeDisabled';
        }
        break;
      }

      case 'messageActionPrizeStars': {
        langPackKey = 'BoostingReceivedGiftNoName';
        break;
      }

      case 'messageActionGiftStars':
      case 'messageActionGiftCode':
      case 'messageActionGiftTon':
      case 'messageActionGiftPremium': {
        const isGiftCode = action._ === 'messageActionGiftCode';
        if(isGiftCode && !shouldDisplayGiftCodeAsGift(action)) {
          langPackKey = 'BoostingReceivedGiftNoName';
          if(action.boost_peer) {
            langPackKey = 'BoostingReceivedGiftFrom';
            args = [getNameDivHTML(getPeerId(action.boost_peer), plain)];
          }

          break;
        }

        const isMe = !!message.pFlags.out && !isGiftCode;
        let authorElement: ReturnType<typeof getNameDivHTML>;
        if(!isMe) {
          authorElement = getNameDivHTML(message.fromId, plain);
        }

        args = authorElement ? [authorElement] : [];

        args.push(paymentsWrapCurrencyAmount(action.amount, action.currency, false, true, plain));

        langPackKey = isMe ? 'ActionGiftOutbound' : 'ActionGiftInbound';

        break;
      }

      case 'messageActionWebViewDataSent': {
        langPackKey = 'ActionBotWebViewData';
        args = [wrapSomeText(action.text, plain)];
        break;
      }

      case 'messageActionRequestedPeer': {
        langPackKey = 'Chat.Service.PeerRequested';
        args = [
          getSeveralNameDivHTML(action.peers.map((peer) => getPeerId(peer)), plain),
          getNameDivHTML(message.peerId, plain)
        ];
        break;
      }

      case 'messageActionGiveawayResults': {
        const r = wrapMessageGiveawayResults(action, plain);
        langPackKey = r.langPackKey;
        args = r.args;
        break;
      }

      case 'messageActionSetChatWallPaper': {
        const isUser = message.peerId.isUser();
        args = [
          getNameDivHTML(isUser ? message.peerId : message.fromId, plain)
        ];

        if(isUser) {
          if(isOwnMessage(message, rootScope.myId)) {
            langPackKey = action.pFlags.for_both ?
              'ActionSetWallpaperForThisChatSelfBoth' : (
                action.pFlags.same ?
                  'ActionSetSameWallpaperForThisChatSelf' :
                  'ActionSetWallpaperForThisChatSelf'
              );
          } else {
            langPackKey = action.pFlags.for_both ?
              'ActionSetWallpaperForThisChatBoth' : (
                action.pFlags.same ?
                  'ActionSetSameWallpaperForThisChat' :
                  'ActionSetWallpaperForThisChat'
              );
          }

          break;
        }

        const isBroadcast = await managers.appPeersManager.isBroadcast(message.peerId);
        if(isBroadcast) {
          langPackKey = 'ActionSetWallpaperForThisChannel';
          break;
        }

        langPackKey = message.fromId === message.peerId ?
          'ActionSetWallpaperForThisGroup' :
          'ActionSetWallpaperForThisGroupByUser';

        break;
      }

      case 'messageActionPaidMessagesPrice': {
        const isBroadcast = await managers.appChatsManager.isBroadcast(message.fromId?.toChatId());
        const result = await getPriceChangedActionMessageLangParams(action, isBroadcast, () => getNameDivHTML(message.fromId, plain));
        langPackKey = result.langPackKey;
        args = result.args;
        break;
      }

      case 'messageActionNoPaidMessagesTokenUsed': {
        if(message.pFlags.out) {
          langPackKey = 'NoPaidMessagesToken.UsedOut';
          args = [getNameDivHTML(message.peerId, plain)];
        } else {
          langPackKey = 'NoPaidMessagesToken.Used';
          args = [getNameDivHTML(message.fromId, plain)];
        }

        break;
      }

      case 'messageActionPaidMessagesRefunded': {
        langPackKey = 'PaidMessages.StarsRefundedShort';
        args = [+action.stars];
        break;
      }
      case 'messageActionStarGift':
      case 'messageActionStarGiftUnique': {
        const params = getStarGiftActionLangParams({
          message,
          action,
          myId: rootScope.myId,
          peerTitle: (peerId) => getNameDivHTML(peerId, plain)
        });

        langPackKey = params.langPackKey;
        args = params.args;
        break;
      }

      case 'messageActionTodoAppendTasks': {
        let listMsg = await managers.appMessagesManager.getMessageByPeer(message.peerId, message.reply_to_mid);
        if(!listMsg) {
          listMsg = await managers.appMessagesManager.fetchMessageReplyTo(message) as Message.message;
        }

        icon = Icon('checklist_add');

        if(listMsg?._ === 'message' && listMsg.media._ === 'messageMediaToDo') {
          if(action.list.length === 1) {
            langPackKey = `ChecklistAddedTask${message.pFlags.out ? 'You' : ''}`;
            args = [
              message.pFlags.out ? undefined : getNameDivHTML(message.fromId, plain),
              wrapSomeText(action.list[0].title.text, plain, action.list[0].title.entities),
              wrapSomeText(listMsg.media.todo.title.text, plain, listMsg.media.todo.title.entities)
            ];
          } else {
            langPackKey = `ChecklistAddedTaskMany${message.pFlags.out ? 'You' : ''}`;
            args = [
              message.pFlags.out ? undefined : getNameDivHTML(message.fromId, plain),
              joinTexts(action.list.map((it) => wrapSomeText(it.title.text, plain, it.title.entities)), TODO_JOIN_OPTIONS),
              wrapSomeText(listMsg.media.todo.title.text, plain, listMsg.media.todo.title.entities)
            ];
          }
        }
        break;
      }
      case 'messageActionTodoCompletions': {
        let listMsg = await managers.appMessagesManager.getMessageByPeer(message.peerId, message.reply_to_mid);
        if(!listMsg) {
          listMsg = await managers.appMessagesManager.fetchMessageReplyTo(message) as Message.message;
        }

        if(listMsg?._ === 'message' && listMsg.media._ === 'messageMediaToDo') {
          const list = listMsg.media.todo;
          const itemsMap = new Map<number, TextWithEntities>();
          for(const it of list.list) {
            itemsMap.set(it.id, it.title);
          }

          const completed = action.completed.map((it) => itemsMap.get(it)).filter(Boolean);
          const incompleted = action.incompleted.map((it) => itemsMap.get(it)).filter(Boolean);

          if(completed.length === 0) {
            icon = Icon('checklist_undone');
            langPackKey = `ChecklistMarkedUndone${message.pFlags.out ? 'You' : ''}`;
            args = [
              message.pFlags.out ? undefined : getNameDivHTML(message.fromId, plain),
              joinTexts(incompleted.map((it) => wrapSomeText(it.text, plain, it.entities)), TODO_JOIN_OPTIONS)
            ];
            break;
          }

          if(incompleted.length === 0) {
            icon = Icon('checklist_done');
            langPackKey = `ChecklistMarkedDone${message.pFlags.out ? 'You' : ''}`;
            args = [
              message.pFlags.out ? undefined : getNameDivHTML(message.fromId, plain),
              joinTexts(completed.map((it) => wrapSomeText(it.text, plain, it.entities)), TODO_JOIN_OPTIONS)
            ];
            break;
          }

          icon = Icon('checklist_done');
          langPackKey = `ChecklistMarkedMixed${message.pFlags.out ? 'You' : ''}`;
          args = [
            message.pFlags.out ? undefined : getNameDivHTML(message.fromId, plain),
            joinTexts(completed.map((it) => wrapSomeText(it.text, plain, it.entities)), TODO_JOIN_OPTIONS),
            joinTexts(incompleted.map((it) => wrapSomeText(it.text, plain, it.entities)), TODO_JOIN_OPTIONS)
          ];
        }

        break;
      }
      case 'messageActionSuggestedPostApproval': {
        if(action.pFlags.balance_too_low) {
          langPackKey = 'SuggestedPosts.BalanceTooLow';
          args = [wrapEmojiText('❌')];
        } else if(action.pFlags.rejected) {
          langPackKey = 'SuggestedPosts.GenericRejectedPost';
          args = [wrapEmojiText('❌')];
        } else {
          langPackKey = 'SuggestedPosts.AgreementReached';
          args = [wrapEmojiText('🤝')];
        }
        break;
      }
      case 'messageActionSuggestedPostSuccess': {
        langPackKey = 'SuggestedPosts.PostSuccess';
        args = [wrapEmojiText('✅'), i18n('Stars', [numberThousandSplitterForStars(action.price.amount)])];
        break;
      }
      case 'messageActionSuggestedPostRefund': {
        langPackKey = 'SuggestedPosts.GenericRefund';
        break;
      }
      case 'messageActionSuggestBirthday': {
        langPackKey = message.pFlags.out ? 'BirthdaySuggestOutgoing' : 'BirthdaySuggestIncoming';
        args = [getNameDivHTML(message.peerId, plain)];

        break
      }
      case 'messageActionStarGiftPurchaseOffer': {
        langPackKey = message.pFlags.out ? 'StarGiftOffer.Outgoing' : 'StarGiftOffer.Incoming';
        args = [
          getNameDivHTML(message.peerId, plain),
          i18n('Stars', [numberThousandSplitterForStars(action.price.amount)]),
          getCollectibleName(action.gift as StarGift.starGiftUnique)
        ];
        break;
      }
      case 'messageActionStarGiftPurchaseOfferDeclined':
        if(action.pFlags.expired) {
          langPackKey = 'StarGiftOffer.ExpiredFull';
        } else {
          langPackKey = message.pFlags.out ? 'StarGiftOffer.RejectedFullOutgoing' : 'StarGiftOffer.RejectedFullIncoming';
        }
        args = [
          getNameDivHTML(message.peerId, plain),
          i18n('Stars', [numberThousandSplitterForStars(action.price.amount)]),
          getCollectibleName(action.gift as StarGift.starGiftUnique)
        ];
        break;
      case 'messageActionNewCreatorPending': {
        langPackKey = 'Chat.Service.NewCreatorPending';
        args = [
          getNameDivHTML(action.new_creator_id.toPeerId(), plain),
          getNameDivHTML(message.fromId, plain)
        ];
        break;
      }
      case 'messageActionChangeCreator': {
        langPackKey = 'Chat.Service.ChangeCreator';
        args = [
          getNameDivHTML(message.fromId, plain),
          getNameDivHTML(action.new_creator_id.toPeerId(), plain)
        ];
        break;
      }
      case 'messageActionBoostApply': {
        langPackKey = 'UserBoostedGroup';
        args = [
          getNameDivHTML(message.fromId, plain),
          action.boosts
        ];
        break;
      }
      case 'messageActionNoForwardsToggle': {
        if(action.new_value === action.prev_value) {
          langPackKey = action.new_value ? 'SharingStillEnabled' : 'SharingStillDisabled';
        } else {
          langPackKey = `Chat.Service.NoForwardsToggle${message.pFlags.out ? '.You' : ''}.${action.new_value ? 'Enabled' : 'Disabled'}` as const;
        }
        args = [getNameDivHTML(message.fromId, plain)];
        break;
      }
      case 'messageActionNoForwardsRequest': {
        if(action.pFlags.expired) {
          langPackKey = 'EnableSharingRequested.Expired';
        } else {
          langPackKey = `Chat.Service.NoForwardsRequest${message.pFlags.out ? '.You' : ''}.${action.new_value ? 'Enable' : 'Disable'}` as const;
          args = [getNameDivHTML(message.fromId, plain)];
        }
        break;
      }
      case 'messageActionPollAppendAnswer': {
        const truncatedAnswerText = wrapTruncatedText(action.answer.text.text, action.answer.text.entities, MAX_ANSWER_TEXT_LENGTH);

        if(message.pFlags.out) {
          langPackKey = 'Chat.Poll.OptionAddedMe';
          args = [truncatedAnswerText];
        } else {
          langPackKey = 'Chat.Poll.OptionAdded';
          args = [getNameDivHTML(message.fromId, plain), truncatedAnswerText];
        }
        break;
      }
      case 'messageActionPollDeleteAnswer': {
        const truncatedAnswerText = wrapTruncatedText(action.answer.text.text, action.answer.text.entities, MAX_ANSWER_TEXT_LENGTH);
        if(message.pFlags.out) {
          langPackKey = 'Chat.Poll.OptionDeletedMe';
          args = [truncatedAnswerText];
        } else {
          langPackKey = 'Chat.Poll.OptionDeleted';
          args = [getNameDivHTML(message.fromId, plain), truncatedAnswerText];
        }
        break;
      }
      case 'messageActionManagedBotCreated': {
        langPackKey = 'CreateBot.BotWasCreated';
        args = [getNameDivHTML(action.bot_id.toPeerId(), plain)];
        break;
      }
      default:
        langPackKey = (langPack[_] || (UNSUPPORTED_ACTIONS.has(_) ? UNSUPPORTED_LANG_PACK_KEY : `[${action._}]`)) as any;
        break;
    }

    if(!langPackKey) {
      langPackKey = langPack[_];
      if(langPackKey === undefined) {
        langPackKey = '[' + _ + ']' as any;
      }
    }

    const waited = args && await Promise.all(args);

    if(plain) {
      return I18n.format(langPackKey, true, waited);
    } else {
      // if(waited && noLinks) {
      //   waited = waited.map((arg) => arg instanceof HTMLAnchorElement ? arg.textContent : arg);
      // }

      const res = _i18n(element, langPackKey, waited);
      if(icon) {
        icon.classList.add('message-action-icon')
        res.prepend(icon);
      }
      return res;
    }

    // str = !langPackKey || langPackKey[0].toUpperCase() === langPackKey[0] ? langPackKey : getNameDivHTML(message.fromId) + langPackKey + (suffix ? ' ' : '');
  }
}
