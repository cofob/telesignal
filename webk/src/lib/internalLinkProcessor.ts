import type AppMediaViewerBase from '@components/mediaViewer/base';
import showSharedFolderInvitePopup from '@components/popups/sharedFolderInvite';
import showJoinChatInvitePopup from '@components/popups/joinChatInvite';
import confirmOpenUrl from '@components/popups/confirmOpenUrl';
import {showSharingPicker2Popup} from '@components/popups/pickUser';
import showStickersPopup from '@components/popups/stickers';
import {toastNew} from '@components/toast';
import {MOUNT_CLASS_TO} from '@config/debug';
import IS_GROUP_CALL_SUPPORTED from '@environment/groupCallSupport';
import {CONFERENCE_CALL_SLUG_REGEXP} from '@lib/calls/constants';
import addAnchorListener, {listenForAnchorClicks, listenForMaskedAnchorAuxClicks} from '@helpers/addAnchorListener';
import {PROXY_LINK_TYPES} from '@lib/richTextProcessor/wrapUrl';
import assumeType from '@helpers/assumeType';
import findUpAttribute from '@helpers/dom/findUpAttribute';
import findUpClassName from '@helpers/dom/findUpClassName';
import {User, ChatlistsChatlistInvite, Chat} from '@layer';
import {i18n, LangPackKey, _i18n} from '@lib/langPack';
import {PHONE_NUMBER_REG_EXP} from '@lib/richTextProcessor';
import appImManager, {JoinConferenceOptions} from '@lib/appImManager';
import {makeFullMid} from '@appManagers/utils/messages/fullMid';
import {INTERNAL_LINK_TYPE, InternalLinkTypeMap, InternalLink} from '@lib/internalLink';
import {parseSignalLink} from '@signal-app/signal-links';
import {lookUpPhoneNumber, openSignalLink} from '@lib/signal/signalLinks';
import {TabManagers} from '@lib/managers';
import {createStoriesViewerWithPeer} from '@components/stories/viewer';
import {simulateClickEvent} from '@helpers/dom/clickEvent';
import shake from '@helpers/dom/shake';
import getPremiumLinkRef from '@helpers/getPremiumLinkRef';
import rootScope from '@lib/rootScope';
import showMyQrCodePopup from '@components/popups/myQrCode';
import anchorCallback from '@helpers/dom/anchorCallback';
import noop from '@helpers/noop';
import appSidebarRight from '@components/sidebarRight';
import pause from '@helpers/schedulers/pause';
import namedPromises from '@helpers/namedPromises';
import {openInstantViewInAppBrowser} from '@components/browser';
import SolidJSHotReloadGuardProvider, {registerHotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import cancelEvent from '@helpers/dom/cancelEvent';
import appSidebarLeft from '@components/sidebarLeft';
import {AppContactsTab} from '@components/solidJsTabs/tabs';
import createNewGroupTab from '@components/sidebarLeft/tabs/createNewGroupTab';
import {AppEditProfileTab, AppSettingsTab} from '@components/solidJsTabs';
import showBirthdayPopup, {saveMyBirthday} from '@components/popups/birthday';
import {getStickerSetInputByShortName} from '@lib/appManagers/utils/stickers/getStickerSetInput';
import {AppMyStoriesTab} from '@components/solidJsTabs/tabs';
import showAddBotToChat from '@components/popups/addBotToChat';
import {isJoinVoiceChatAnchor} from '@components/wrappers/joinVoiceChatAnchor';
import getBotAddToChatScope from '@appManagers/utils/bots/getBotAddToChatScope';
import parseBotAdminRights from '@appManagers/utils/bots/parseBotAdminRights';
import isEphemeralMessage from '@appManagers/utils/messages/isEphemeralMessage';
import parseChatSpecificTag from '@lib/richTextProcessor/parseChatSpecificTag';
import searchByTag from '@lib/richTextProcessor/searchByTag';
import {APP_TABS} from '@lib/appColumns';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import openBankCardMenu from '@components/bankCardMenu';
import confirmationPopup from '@components/confirmationPopup';
import wrapPeerTitle from '@components/wrappers/peerTitle';
import wrapRichText from '@lib/richTextProcessor/wrapRichText';
import {getManagersSession, isSessionLeaving} from '@lib/accounts/getCurrentAccount';
import {tryDecodeURIComponent} from '@helpers/string/parseUriParams';

/**
 * For a lookup whose failure is only a miss: any error is one but MIDDLEWARE, the end of the account
 * session it was asked in - the flow it belongs to stops there rather than go on as a miss on the
 * account the tab shows now.
 */
const missUnlessSessionEnded = (err: ApiError): undefined => {
  if(err?.type === 'MIDDLEWARE') {
    throw err;
  }

  return undefined;
};

/**
 * A link whose section we know but whose path we do not — the one thing worse
 * than not opening it is doing nothing about it. tdesktop answers the same way
 * (`Router::showUnsupportedMessage`).
 */
const showUnsupportedLinkToast = () => {
  toastNew({langPackKey: 'Link.NotSupported'});
};

export class InternalLinkProcessor {
  protected managers: TabManagers;
  private processingAddAiStyleSlugs: Set<string> = new Set();
  private tagSearchVersion = 0;

  public showUsernameResolveError(err: ApiError) {
    if(err.type === 'USERNAME_NOT_OCCUPIED') {
      toastNew({langPackKey: 'NoUsernameFound'});
    } else if(err.type === 'USERNAME_INVALID') {
      toastNew({langPackKey: 'Alert.UserDoesntExists'});
    }
  }

  /**
   * Asks before a link goes where its address points - a masked link's real address, a tg:// link
   * this client cannot open - and Open follows it as a plain link, within that press of the button.
   */
  private showOpenUrlAlert(element: HTMLAnchorElement) {
    const a = element.cloneNode(true) as HTMLAnchorElement;
    a.removeAttribute('onclick');
    // * TeleSignal: a masked Signal link opens in the app once the user agrees
    const signalLink = parseSignalLink(a.href);
    confirmOpenUrl(a, undefined, signalLink ? () => openSignalLink(signalLink) : undefined);
  }

  public construct(managers: TabManagers) {
    this.managers = managers;

    // a middle click never reaches an anchor's inline `onclick`, so the alert below is wired to it
    // separately — otherwise the masked link opens in a new tab with nothing asked
    listenForMaskedAnchorAuxClicks();
    listenForAnchorClicks();

    addAnchorListener<{}>({
      name: 'showMaskedAlert',
      callback: ({element}) => this.showOpenUrlAlert(element)
    });

    // a tg:// link that nothing below handles (wrapUrl names this handler for it)
    addAnchorListener<{}>({
      name: 'unknownDeepLink',
      noPathnameParams: true,
      noUriParams: true,
      callback: ({element}) => this.processUnknownDeepLink(element)
    });

    // * a proxy to connect to (t.me/proxy?…, t.me/socks?…, tg://proxy?…, tg://socks?…): a browser cannot
    // * reach Telegram through one, so it is a link this client does not open, never the profile @proxy
    PROXY_LINK_TYPES.forEach((name) => {
      addAnchorListener({name, noPathnameParams: true, noUriParams: true, callback: showUnsupportedLinkToast});
      addAnchorListener({name, protocol: 'tg', noPathnameParams: true, noUriParams: true, callback: showUnsupportedLinkToast});
    });

    // a bank card number in a text (wrapRichText) is a link to its menu, not to anywhere
    (window as any).onBankCardClick = (element: HTMLElement, e: MouseEvent) => {
      cancelEvent(e);
      openBankCardMenu(element, e);
    };

    addAnchorListener<{uriParams: {command: string, bot: string}}>({
      name: 'execBotCommand',
      callback: ({element, uriParams}) => {
        const {command, bot} = uriParams;
        const chat = appImManager.chat;
        let sendingParams = chat.input?.getEphemeralSendingSnapshot() || {
          peerId: chat.peerId,
          threadId: chat.threadId
        };
        const bubble = findUpClassName(element, 'bubble');
        if(
          bubble?.dataset.mid &&
          bubble.dataset.peerId?.toPeerId() === chat.peerId
        ) {
          const message = chat.getMessage(+bubble.dataset.mid);
          if(isEphemeralMessage(message)) {
            sendingParams = {
              ephemeral: true,
              peerId: chat.peerId,
              threadId: chat.threadId,
              replyToMsgId: message.mid
            };
          }
        }

        /* const promise = bot ? this.openUsername(bot).then(() => this.chat.peerId) : Promise.resolve(this.chat.peerId);
        promise.then((peerId) => {
          this.managers.appMessagesManager.sendText(peerId, '/' + command);
        }); */

        return this.managers.appMessagesManager.sendText({
          ...sendingParams,
          text: '/' + command + (bot ? '@' + bot : '')
        });
      }
    });

    addAnchorListener<{uriParams: {hashtag: string}}>({
      name: 'searchByHashtag',
      callback: ({uriParams}) => {
        const {hashtag} = uriParams;
        if(!hashtag) {
          return;
        }

        const search = parseChatSpecificTag(hashtag);
        const version = ++this.tagSearchVersion;
        return searchByTag({
          query: search.query + ' ',
          username: search.username,
          activateSearch: (query) => appImManager.chat.initSearch({query, focus: true}),
          resolveUsername: (username) => this.managers.appUsersManager.resolveUsername(username),
          openPeer: (peer) => appImManager.setInnerPeer({
            peerId: peer.id.toPeerId(peer._ !== 'user')
          }),
          isCurrent: () => version === this.tagSearchVersion,
          onResolveError: (err) => {
            appImManager.chat.resetSearch();
            this.showUsernameResolveError(err as ApiError);
          }
        });
      }
    });

    addAnchorListener<{}>({
      name: 'setMediaTimestamp',
      callback: ({element}) => {
        const timestamp = +element.dataset.timestamp;
        const bubble = findUpClassName(element, 'bubble');
        if(bubble) {
          appImManager.chat.bubbles.playMediaWithTimestamp(element, timestamp);
          return;
        }

        if(findUpClassName(element, 'media-viewer-caption')) {
          const appMediaViewer = (window as any).appMediaViewer as AppMediaViewerBase<any, any, any>;
          return appMediaViewer.setMediaTimestamp(timestamp);
        }
      }
    });

    // * TeleSignal: a Signal link in a message opens in the app (`lib/signal/signalLinks.ts`)
    addAnchorListener({
      name: 'signal_link',
      noPathnameParams: true,
      noUriParams: true,
      callback: ({element}) => {
        const link = parseSignalLink(element.href);
        if(link) return openSignalLink(link);
      }
    });

    ([
      ['addstickers', INTERNAL_LINK_TYPE.STICKER_SET],
      ['addemoji', INTERNAL_LINK_TYPE.EMOJI_SET]
    ] as [
      'addstickers' | 'addemoji',
      INTERNAL_LINK_TYPE.STICKER_SET | INTERNAL_LINK_TYPE.EMOJI_SET
    ][]).forEach(([name, type]) => {
      addAnchorListener<{pathnameParams: [typeof name, string]}>({
        name,
        callback: ({pathnameParams}) => {
          if(!pathnameParams[1]) {
            return;
          }

          const link: InternalLink = {
            _: type,
            set: pathnameParams[1]
          };

          return this.processInternalLink(link);
        }
      });

      addAnchorListener<{
        uriParams: {
          set: string
        }
      }>({
        name,
        protocol: 'tg',
        callback: ({uriParams}) => {
          const link = this.makeLink(type, uriParams);
          return this.processInternalLink(link);
        }
      });
    });

    // * t.me/invoice/asdasdad
    // * t.me/$asdasdad
    addAnchorListener<{pathnameParams: ['invoice', string] | string}>({
      name: 'invoice',
      callback: ({pathnameParams}) => {
        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.INVOICE,
          slug: pathnameParams.length > 1 ? pathnameParams[1] : pathnameParams[0].slice(1)
        };

        return this.processInternalLink(link);
      }
    });

    // t.me/addlist/adasdasd
    addAnchorListener<{pathnameParams: ['folder', string]}>({
      name: 'addlist',
      callback: ({pathnameParams}) => {
        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.ADD_LIST,
          slug: pathnameParams[1]
        };

        return this.processInternalLink(link);
      }
    });

    // Support old t.me/joinchat/asd and new t.me/+asd
    addAnchorListener<{pathnameParams: ['joinchat', string]}>({
      name: 'joinchat',
      callback: ({pathnameParams}) => {
        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.JOIN_CHAT,
          invite: pathnameParams[1] || decodeURIComponent(pathnameParams[0]).slice(1)
        };

        return this.processInternalLink(link);
      }
    });

    if(IS_GROUP_CALL_SUPPORTED) {
      addAnchorListener<{
        uriParams: Omit<InternalLink.InternalLinkVoiceChat, '_'>
      }>({
        name: 'voicechat',
        protocol: 'tg',
        callback: ({uriParams, element}) => {
          const link = this.makeLink(INTERNAL_LINK_TYPE.VOICE_CHAT, uriParams);
          // * straight to the handler: only here is it known whether the press was on the chat's own "join"
          return this.processVoiceChatLink(link, {fromServiceMessage: isJoinVoiceChatAnchor(element)});
        }
      });

      // t.me/call/<slug> — TdE2E conference invite link. tdesktop maps this
      // to `tg://call?slug=<slug>` (local_url_handlers.cpp:1967) and then to
      // `ResolveConferenceCall` (window_session_controller.cpp:977). Here we
      // resolve the slug straight into `joinConference` since the controller
      // already does the chain-head poll itself.
      addAnchorListener<{pathnameParams: ['call', string]}>({
        name: 'call',
        callback: ({pathnameParams, element, event}) => {
          if(!pathnameParams[1]) return;
          const link: InternalLink = {
            _: INTERNAL_LINK_TYPE.CONFERENCE_CALL,
            slug: pathnameParams[1]
          };
          // Straight to the handler rather than through `processInternalLink`:
          // this is the only place that still knows WHICH message the link was
          // clicked in, and the join confirmation names its sender.
          return this.processConferenceCallLink(link, {
            inviterPeerId: this.getClickedMessageSenderPeerId(element, event)
          });
        }
      });

      // tg://call?slug=<slug>
      addAnchorListener<{uriParams: {slug: string}}>({
        name: 'call',
        protocol: 'tg',
        callback: ({uriParams}) => {
          if(!uriParams.slug) return;
          const link = this.makeLink(INTERNAL_LINK_TYPE.CONFERENCE_CALL, uriParams);
          return this.processInternalLink(link);
        }
      });
    }

    type K1 = {thread?: string, comment?: string, t?: string, option?: string, single?: string};
    type K2 = {thread?: string, comment?: string, start?: string, startgroup?: string, startchannel?: string, admin?: string, t?: string, text?: string, option?: string, single?: string, game?: string};
    type K5 = {story?: string};
    type K7 = {voicechat?: string, videochat?: string, livestream?: string};
    type K8 = {text?: string};

    addAnchorListener<{
    //   pathnameParams: ['c', string, string],
    //   uriParams: {thread?: number}
    // } | {
    //   pathnameParams: [string, string?],
    //   uriParams: {comment?: number}
      pathnameParams: ['c', string, string] | [string, string?],
      uriParams: K1 | K2 | K5 | K7 | K8
    }>({
      name: 'im',
      callback: async({pathnameParams, uriParams, element, masked}) => {
        // t.me/s/<username> is the web page of a chat, and names it as t.me/<username> does (Android reads it so)
        if(pathnameParams?.[0] === 's' && pathnameParams.length > 1) {
          pathnameParams = pathnameParams.slice(1) as typeof pathnameParams;
        }

        let link: InternalLink;
        if('voicechat' in uriParams || 'videochat' in uriParams || 'livestream' in uriParams) {
          assumeType<K7>(uriParams);
          link = {
            _: INTERNAL_LINK_TYPE.VOICE_CHAT,
            domain: pathnameParams[0],
            ...uriParams
          };
        } else if(pathnameParams?.[1] === 's') {
          link = {
            _: INTERNAL_LINK_TYPE.STORY,
            domain: pathnameParams[0],
            story: pathnameParams[2]
          };
        } else if(pathnameParams?.[1] === 'c') {
          link = {
            _: INTERNAL_LINK_TYPE.STAR_GIFT_COLLECTION,
            domain: pathnameParams[0],
            id: pathnameParams[2]
          };
        } else if(pathnameParams?.[1] === 'a') {
          link = {
            _: INTERNAL_LINK_TYPE.STORY_ALBUM,
            domain: pathnameParams[0],
            id: pathnameParams[2]
          };
        } else if(PHONE_NUMBER_REG_EXP.test(pathnameParams[0])) {
          link = {
            _: INTERNAL_LINK_TYPE.USER_PHONE_NUMBER,
            phone: pathnameParams[0],
            text: (uriParams as K8).text
          };
        } else if(pathnameParams[0] === 'c') {
          assumeType<K1>(uriParams);
          pathnameParams.shift();
          const thread = 'thread' in uriParams ? uriParams.thread : pathnameParams[2] && pathnameParams[1];
          link = {
            _: INTERNAL_LINK_TYPE.PRIVATE_POST,
            channel: pathnameParams[0],
            post: pathnameParams[2] || pathnameParams[1],
            thread,
            comment: uriParams.comment,
            option: 'option' in uriParams ? uriParams.option : undefined,
            stack: appImManager.getStackFromElement(element),
            t: uriParams.t,
            single: uriParams.single
          };
        } else {
          assumeType<K2>(uriParams);
          const thread = 'thread' in uriParams ? uriParams.thread : pathnameParams[2] && pathnameParams[1];
          link = {
            _: INTERNAL_LINK_TYPE.MESSAGE,
            domain: pathnameParams[0],
            post: pathnameParams[2] || pathnameParams[1],
            thread,
            comment: uriParams.comment,
            start: 'start' in uriParams ? uriParams.start : undefined,
            startgroup: 'startgroup' in uriParams ? uriParams.startgroup : undefined,
            startchannel: 'startchannel' in uriParams ? uriParams.startchannel : undefined,
            admin: 'admin' in uriParams ? uriParams.admin : undefined,
            option: 'option' in uriParams ? uriParams.option : undefined,
            stack: appImManager.getStackFromElement(element),
            t: uriParams.t,
            text: uriParams.text,
            single: uriParams.single,
            game: uriParams.game
          };
        }

        return this.processInternalLink(link);
      }
    });

    addAnchorListener<{
      uriParams: {
        domain: string,

        // telegrampassport
        scope?: string,
        nonce?: string,
        payload?: string,
        bot_id?: string,
        public_key?: string,
        callback_url?: string,

        // regular
        start?: string,
        startgroup?: string,
        startchannel?: string,
        admin?: string,
        game?: string,
        voicechat?: string,
        videochat?: string,
        livestream?: string,
        post?: string,
        thread?: string,
        comment?: string,
        phone?: string,
        t?: string,
        story?: string,
        single?: string
      }
    }>({
      name: 'resolve',
      protocol: 'tg',
      callback: ({uriParams, element, masked}) => {
        let link: InternalLink;
        if(uriParams.voicechat !== undefined || uriParams.videochat !== undefined || uriParams.livestream !== undefined) {
          link = this.makeLink(INTERNAL_LINK_TYPE.VOICE_CHAT, uriParams as Required<typeof uriParams>);
        } else if(uriParams.story) {
          link = this.makeLink(INTERNAL_LINK_TYPE.STORY, uriParams as Required<typeof uriParams>);
        } else if(uriParams.phone) {
          link = this.makeLink(INTERNAL_LINK_TYPE.USER_PHONE_NUMBER, uriParams as Required<typeof uriParams>);
        } else if(uriParams.domain === 'telegrampassport') {

        } else {
          link = this.makeLink(INTERNAL_LINK_TYPE.MESSAGE, {
            ...uriParams,
            stack: appImManager.getStackFromElement(element)
          });
        }

        return this.processInternalLink(link);
      }
    });

    addAnchorListener<{
      uriParams: {
        channel: string,
        post: string,
        thread?: string,
        comment?: string,
        single?: string
      }
    }>({
      name: 'privatepost',
      protocol: 'tg',
      callback: ({uriParams}) => {
        const link = this.makeLink(INTERNAL_LINK_TYPE.PRIVATE_POST, uriParams);
        return this.processInternalLink(link);
      }
    });

    // tg://invoice?slug=asdasd
    addAnchorListener<{
      uriParams: {
        slug: string
      }
    }>({
      name: 'invoice',
      protocol: 'tg',
      callback: ({uriParams}) => {
        const link = this.makeLink(INTERNAL_LINK_TYPE.INVOICE, uriParams);
        return this.processInternalLink(link);
      }
    });

    // tg://addlist?slug=asd
    addAnchorListener<{
      uriParams: {
        slug: string
      }
    }>({
      name: 'addlist',
      protocol: 'tg',
      callback: ({uriParams}) => {
        const link = this.makeLink(INTERNAL_LINK_TYPE.ADD_LIST, uriParams);
        return this.processInternalLink(link);
      }
    });

    ['joinchat' as const, 'join' as const].forEach((name) => {
      addAnchorListener<{
        uriParams: {
          invite: string
        }
      }>({
        name,
        protocol: 'tg',
        callback: ({uriParams}) => {
          const link = this.makeLink(INTERNAL_LINK_TYPE.JOIN_CHAT, uriParams);
          return this.processInternalLink(link);
        }
      });
    });

    // tg://premium_offer?ref=premium tg://premium_offer
    addAnchorListener<{
      uriParams: {
        ref?: string
      }
    }>({
      name: 'premium_offer',
      protocol: 'tg',
      callback: ({uriParams}) => {
        const link = this.makeLink(INTERNAL_LINK_TYPE.PREMIUM_FEATURES, uriParams);
        return this.processInternalLink(link);
      }
    });

    // t.me/GetPremium?ref=twitter = tg://premium_offer?ref=tme_getpremium_twitter
    addAnchorListener<{
      uriParams: {
        ref?: string
      }
    }>({
      name: 'premium_offer',
      noPathnameParams: true,
      callback: ({uriParams}) => {
        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.PREMIUM_FEATURES,
          ref: getPremiumLinkRef(uriParams.ref)
        };

        return this.processInternalLink(link);
      }
    });

    // t.me/giftcode/slug
    addAnchorListener<{pathnameParams: ['giftcode', string]}>({
      name: 'giftcode',
      callback: ({pathnameParams, element}) => {
        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.GIFT_CODE,
          slug: pathnameParams[1],
          stack: appImManager.getStackFromElement(element)
        };

        return this.processInternalLink(link);
      }
    });

    // tg://giftcode?slug=...
    addAnchorListener<{
      uriParams: {
        slug: string
      }
    }>({
      name: 'giftcode',
      protocol: 'tg',
      callback: ({uriParams, element}) => {
        const link = this.makeLink(INTERNAL_LINK_TYPE.GIFT_CODE, uriParams);
        link.stack = appImManager.getStackFromElement(element);
        return this.processInternalLink(link);
      }
    });

    // tg://stars_topup?amount=100
    addAnchorListener<{
      uriParams: {
        balance: string,
        purpose: string
      }
    }>({
      name: 'stars_topup',
      protocol: 'tg',
      callback: ({uriParams}) => {
        const link = this.makeLink(INTERNAL_LINK_TYPE.STARS_TOPUP, uriParams);
        return this.processInternalLink(link);
      }
    });

    // t.me/share/url?url=...&text=...
    addAnchorListener<{pathnameParams: ['share', 'url'], uriParams: {url?: string, text?: string}}>({
      name: 'share',
      callback: ({pathnameParams, uriParams}) => {
        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.SHARE,
          url: uriParams.url,
          text: uriParams.text
        };

        return this.processInternalLink(link);
      }
    });

    addAnchorListener<{
      uriParams: {
        url?: string,
        text?: string
      }
    }>({
      name: 'msg_url',
      protocol: 'tg',
      callback: ({uriParams}) => {
        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.SHARE,
          url: uriParams.url,
          text: uriParams.text
        };

        return this.processInternalLink(link);
      }
    });

    // t.me/nft/asdasd-1
    addAnchorListener<{pathnameParams: ['nft', string]}>({
      name: 'nft',
      callback: ({pathnameParams}) => {
        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.UNIQUE_STAR_GIFT,
          slug: pathnameParams.slice(1).join('/') // support unescaped slash
        };

        return this.processInternalLink(link);
      }
    });

    // tg://nft?slug=...
    addAnchorListener<{
      uriParams: {
        slug: string
      }
    }>({
      name: 'nft',
      protocol: 'tg',
      callback: ({uriParams}) => {
        const link = this.makeLink(INTERNAL_LINK_TYPE.UNIQUE_STAR_GIFT, uriParams);
        return this.processInternalLink(link);
      }
    });

    // tg://iv?url=...
    addAnchorListener<{
      uriParams: {
        url: string
      },
    }>({
      name: 'iv',
      protocol: 'tg',
      noCancelEvent: true,
      callback: ({element, event}) => {
        if((event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey) {
          return;
        }

        cancelEvent(event);
        const link = this.makeLink(INTERNAL_LINK_TYPE.INSTANT_VIEW, {url: element.href});
        return this.processInternalLink(link);
      }
    });

    // tg://new/
    // tg://new/group
    // tg://new/contact
    addAnchorListener<{
      pathnameParams: [InternalLink.InternalLinkNew['type'] | '']
    }>({
      name: 'new',
      protocol: 'tg',
      callback: ({pathnameParams}) => {
        const [type = ''] = pathnameParams;
        switch(type) {
          // * TeleSignal: Signal adds no contacts; the contacts list is where a number is found from its search
          case 'contact':
            return appSidebarLeft.createTab(AppContactsTab).open();
          case 'group':
            return createNewGroupTab(appSidebarLeft);
          case '':
            // the screen every "new" starts from
            return appSidebarLeft.createTab(AppContactsTab).open();
          default:
            return showUnsupportedLinkToast();
        }
      }
    });

    addAnchorListener<{
      pathnameParams: string[],
      uriParams: {highlight?: string}
    }>({
      name: 'settings',
      protocol: 'tg',
      callback: ({pathnameParams, uriParams}) => {
        // the table is written with trailing slashes in places
        // (`tg://settings/privacy/phone-number/`) and the generated index strips
        // them, so a path has to arrive here the same way it was addressed there
        const path = pathnameParams.join('/').replace(/\/$/, '');
        switch(path) {
          case '':
            // reuse the open Settings instead of stacking a second one
            return (appSidebarLeft.getTab(AppSettingsTab) || appSidebarLeft.createTab(AppSettingsTab)).open();
          case 'edit':
          case 'edit/set-photo':
          case 'edit/first-name':
          case 'edit/last-name':
          case 'edit/bio':
          case 'edit/username':
          case 'edit/channel':
          case 'profile-photo': {
            // `noSame` hands back the editor when it is already open, and a tab
            // inits once — so the field is pointed at afterwards, from outside,
            // the way every other settings link points at its control.
            const tab = appSidebarLeft.createTab(AppEditProfileTab);
            return tab.open().then(async() => {
              // pointing at a field while the tab is still sliding in scrolls it
              await tab.shown;

              if(path === 'profile-photo' || path === 'edit/set-photo') {
                shake(tab.container.querySelector('.edit-profile-photo'));
                return;
              }

              const [{findSettingsLink}, {focusControl, highlightSettingsEntry}] = await Promise.all([
                import('@lib/settingsSearch/link'),
                import('@lib/settingsSearch/highlight')
              ]);

              // which label a path names is the link table's business, the same
              // table the search copies links from
              const key = findSettingsLink(path)?.highlight;
              if(!key) {
                return;
              }

              // the personal channel is a row opening a picker, not a field to
              // type in, so it is flashed the way the search points at it
              if(path === 'edit/channel') {
                highlightSettingsEntry(tab, key);
                return;
              }

              focusControl(key, {root: tab.container, middleware: tab.middlewareHelper.get()});
            });
          }
          case 'edit/birthday':
            return this.managers.appProfileManager.getProfile(rootScope.myId).then((userFull) => {
              showBirthdayPopup({
                initialDate: userFull.birthday,
                fromProfile: true,
                onSave: saveMyBirthday
              });
            });
          case 'edit/add-account':
            // tdesktop points at the control instead of starting the flow
            // (`SettingsControl{InformationId(), "edit/add-account"}`); ours lives
            // in the chat list's menu, so that is the menu we open.
            return appImManager.selectTab(APP_TABS.CHATLIST).then(() => {
              return this.highlightMenuItem(
                appSidebarLeft.sidebarEl.querySelector('.sidebar-header .btn-menu-toggle'),
                'MultiAccount.AddAccount'
              );
            });
          case 'edit/log-out': {
            // tdesktop shows Settings with the log-out control highlighted
            // (`ShowLogOutMenu`) — a link must not open the confirmation itself.
            // Ours lives in the header menu, so the menu is opened and the item
            // inside it is the one that flashes.
            const settingsTab = appSidebarLeft.getTab(AppSettingsTab) || appSidebarLeft.createTab(AppSettingsTab);
            return settingsTab.open().then(async() => {
              // a menu opened over a tab that is still sliding in would jump
              await settingsTab.shown;
              return this.highlightMenuItem(
                settingsTab.header.querySelector('.btn-menu-toggle'),
                'EditAccount.Logout'
              );
            });
          }
          // case 'edit/change-number':
          // case 'edit/your-color':

          // an alias of `tg://chats/emoji-status`, the way tdesktop keeps it
          case 'emoji-status':
            return this.showEmojiStatusPicker();

          // * TeleSignal: Signal has no Premium, Stars or gifts
          case 'premium':
          case 'stars':
          case 'stars/gift':
          case 'send-gift':
          case 'send-gift/self':
          case 'ton':
            return showUnsupportedLinkToast();

          // the own QR code, as tdesktop and Android open it; `/share` points at its Share button (tdesktop), where
          // Android presses it
          case 'qr-code':
            return showMyQrCodePopup();
          case 'qr-code/share':
            return showMyQrCodePopup(rootScope.myId, {highlightShare: true});

          // destinations outside Settings, which the section table cannot address
          case 'saved-messages':
            return appImManager.setPeer({peerId: appImManager.myId});
          case 'my-profile/posts/all-stories':
            return appSidebarLeft.createTab(AppMyStoriesTab).open(AppMyStoriesTab.getInitArgs());
          case 'my-profile/archived-posts':
            return appSidebarLeft.createTab(AppMyStoriesTab).open({
              ...AppMyStoriesTab.getInitArgs(),
              isArchive: true
            });

          // tdesktop, Android and iOS open the change-email screen itself, which
          // is what the Login Email row does — not the row to point at
          case 'login_email':
            return Promise.all([
              this.managers.passwordManager.getState(),
              import('@components/sidebarLeft/tabs/changeLoginEmail')
            ]).then(([passwordState, {openChangeLoginEmailTab}]) => {
              return openChangeLoginEmailTab(appSidebarLeft, passwordState);
            });

          default:
            // Every section the settings search indexes is addressable — see
            // @lib/settingsSearch/link. Imported lazily to keep the index out of
            // the startup bundle.
            return import('@lib/settingsSearch/navigate').then(async({openSettingsDeepLink}) => {
              if(!await openSettingsDeepLink(path, uriParams.highlight, appSidebarLeft)) {
                showUnsupportedLinkToast();
              }
            }).catch((err) => console.error('settings link failed', path, err));
        }
      }
    });

    // tg://contacts/
    // tg://contacts/search
    // tg://contacts/sort
    // tg://contacts/new
    // tg://contacts/invite
    // tg://contacts/manage
    addAnchorListener<{
      pathnameParams: [InternalLink.InternalLinkContacts['type'] | '']
    }>({
      name: 'contacts',
      protocol: 'tg',
      callback: ({pathnameParams}) => {
        const [type = ''] = pathnameParams;
        switch(type) {
          // * TeleSignal: Signal adds no contacts
          case 'new':
          case 'search':
          case '':
            return appSidebarLeft.createTab(AppContactsTab).open();
          case 'sort':
            return appSidebarLeft.createTab(AppContactsTab).open({highlight: 'sort'});
          // case 'invite':
          // case 'manage':
          default:
            return showUnsupportedLinkToast();
        }
      }
    });

    // tg://chats/search
    // tg://chats/emoji-status
    addAnchorListener<{
      pathnameParams: [InternalLink.InternalLinkChats['type'] | '']
    }>({
      name: 'chats',
      protocol: 'tg',
      callback: ({pathnameParams}) => {
        const [type] = pathnameParams;
        switch(type) {
          case 'search':
            return this.openChatListSearch();
          case 'emoji-status':
            return this.showEmojiStatusPicker();
          // tdesktop's `chats` section answers to these two paths and nothing
          // else — a bare `tg://chats` included
          default:
            return showUnsupportedLinkToast();
        }
      }
    });

    // t.me/addstyle/<slug>
    addAnchorListener<{pathnameParams: ['addstyle', string]}>({
      name: 'addstyle',
      callback: ({pathnameParams}) => {
        if(!pathnameParams[1]) {
          return;
        }

        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.ADD_AI_STYLE,
          slug: pathnameParams[1]
        };

        return this.processInternalLink(link);
      }
    });

    // t.me/contact/<token>
    addAnchorListener<{pathnameParams: ['contact', string]}>({
      name: 'contact',
      callback: ({pathnameParams}) => {
        // the path keeps the token percent-encoded; a broken escape leaves it as it came, a dead link
        const token = tryDecodeURIComponent(pathnameParams[1] || '');

        const link: InternalLink = {
          _: INTERNAL_LINK_TYPE.CONTACT_TOKEN,
          token
        };

        return this.processInternalLink(link);
      }
    });

    // tg://contact?token=<token>
    addAnchorListener<{uriParams: {token?: string}}>({
      name: 'contact',
      protocol: 'tg',
      callback: ({uriParams}) => {
        const link = this.makeLink(INTERNAL_LINK_TYPE.CONTACT_TOKEN, {token: uriParams.token || ''});
        return this.processInternalLink(link);
      }
    });
  }

  /** What `tg://chats/emoji-status` — and its `tg://settings` alias — opens. */
  private showEmojiStatusPicker() {
    const managers = bindManagersToSession(this.managers);
    // iOS opens the picker itself, from where it always opens — for us
    // that is the status button in the chat list header.
    const statusBtn = appSidebarLeft.sidebarEl.querySelector<HTMLElement>('.sidebar-emoji-status');

    // no button means no emoji status to set: the link has nothing to open
    if(!statusBtn) {
      return showUnsupportedLinkToast();
    }

    return appImManager.selectTab(APP_TABS.CHATLIST).then(async() => {
      // the button belongs to the chat list's own header, so whatever is
      // stacked over the list has to go — the natural way, letting a tab
      // that asks before closing ask
      if(!await appSidebarLeft.closeEverythingInsideNaturally()) {
        return;
      }

      // the button opens the picker on its own, and plays its animation
      // when the status changes; only a collapsed column hides it, and a
      // hidden anchor would leave the picker in the corner of the screen
      if(statusBtn.offsetParent) {
        simulateClickEvent(statusBtn);
        return;
      }

      const {openEmojiStatusPicker} = await import('@components/sidebarLeft/emojiStatusPicker');
      openEmojiStatusPicker({
        managers,
        anchorElement: statusBtn.closest('.sidebar-header')
      });
    });
  }

  /**
   * Puts the caret in the chat list's search — what tdesktop's `chats/search`
   * does (`searchMessages(QString(), Dialogs::Key())`): the field, empty, with
   * nothing left over it.
   */
  private async openChatListSearch() {
    await appImManager.selectTab(APP_TABS.CHATLIST);

    if(!await appSidebarLeft.closeEverythingInsideNaturally()) {
      return;
    }

    appSidebarLeft.initSearch().open();
  }

  /** Points at a control that lives in the menu behind `toggle`. */
  private async highlightMenuItem(toggle: HTMLElement, key: LangPackKey) {
    const {highlightMenuControl} = await import('@lib/settingsSearch/highlight');
    highlightMenuControl(toggle, key);
  }

  private makeLink<T extends INTERNAL_LINK_TYPE>(type: T, uriParams: Omit<InternalLinkTypeMap[T], '_'>) {
    return {
      _: type,
      ...uriParams
    } as any as InternalLinkTypeMap[T];
  }

  public processMessageLink = async(link: InternalLink.InternalLinkMessage) => {
    const managers = bindManagersToSession(this.managers);
    if(link.game) {
      return this.shareGame(link);
    }

    if(link.startgroup !== undefined || link.startchannel !== undefined) {
      const requestedRights = parseBotAdminRights(link.admin);
      const scope = getBotAddToChatScope(link, requestedRights);
      return managers.appUsersManager.resolveUsername(link.domain).then(async(peer) => {
        if(peer._ === 'user' && peer.pFlags.bot) {
          await showAddBotToChat({
            botId: peer.id as BotId,
            scope,
            startParam: link.startgroup,
            requestedRights
          });
          return;
        }

        await appImManager.openUsername({userName: link.domain});
      }, (err: ApiError) => {
        this.showUsernameResolveError(err);
      });
    }

    const postId = link.post ? +link.post : undefined;
    const commentId = link.comment ? +link.comment : undefined;
    const threadId = link.thread ? +link.thread : undefined;

    return appImManager.openUsername({
      userName: link.domain,
      lastMsgId: postId,
      pollOption: link.option,
      commentId,
      startParam: link.start,
      stack: link.stack,
      threadId,
      mediaTimestamp: link.t && +link.t,
      text: link.text,
      wholeAlbum: link.single === undefined
    });
  };

  /**
   * `t.me/<bot>?game=<short_name>`: the game goes to a chat the user picks - never Saved Messages - once they
   * confirm it, and that chat opens (tdesktop's `ShowShareGameBox`). A name that is not a bot's opens as it would
   * without the game.
   */
  private async shareGame(link: InternalLink.InternalLinkMessage): Promise<unknown> {
    const managers = bindManagersToSession(this.managers);
    const bot = await managers.appUsersManager.resolveUserByUsername(link.domain).catch(missUnlessSessionEnded);
    if(!bot || !bot.pFlags.bot) {
      return this.processMessageLink({...link, game: undefined});
    }

    let chosen: Awaited<ReturnType<typeof showSharingPicker2Popup>>;
    try {
      chosen = await showSharingPicker2Popup({
        chatRightsActions: ['send_games'],
        exceptSelf: true
      });

      await confirmationPopup({
        descriptionLangKey: 'SendGameToText',
        descriptionLangArgs: [await wrapPeerTitle({peerId: chosen.peerId})],
        button: {langKey: 'OK'}
      });
    } catch{
      return;
    }

    // * confirmed for the account it was asked on: nothing is sent or opened once the tab is on another
    if(isSessionLeaving(getManagersSession(managers))) {
      return;
    }

    const {peerId} = chosen;
    managers.appGamesManager.shareGame({
      peerId,
      botId: bot.id,
      shortName: link.game
    }).catch((err: ApiError) => {
      // * no message stands for the game until the server sends it, so the chat cannot show that it
      // * failed: it is said here, as tdesktop does; a slow mode wait has its own popup (appImManager)
      if(err?.type === 'MIDDLEWARE' || err?.type?.startsWith('SLOWMODE_WAIT')) {
        return;
      }

      toastNew({langPackKey: 'Error.AnError'});
    });

    return appImManager.setInnerPeer({peerId});
  }

  public processPrivatePostLink = async(link: InternalLink.InternalLinkPrivatePost) => {
    const managers = bindManagersToSession(this.managers);
    const chatId = link.channel.toChatId();

    const chat = await managers.appChatsManager.getChat(chatId);
    if(!chat) {
      try {
        await managers.appChatsManager.resolveChannel(chatId);
      } catch(err) {
        toastNew({langPackKey: 'LinkNotFound'});
        throw err;
      }
    }

    const postId = +link.post;
    const threadId = link.thread ? +link.thread : undefined;

    return appImManager.op({
      peer: chat,
      lastMsgId: postId,
      threadId,
      pollOption: link.option,
      stack: link.stack,
      mediaTimestamp: link.t && +link.t,
      wholeAlbum: link.single === undefined
    });
  };

  public processStickerSetLink = (link: InternalLink.InternalLinkStickerSet | InternalLink.InternalLinkEmojiSet) => {
    return showStickersPopup(getStickerSetInputByShortName(link.set), link._ === INTERNAL_LINK_TYPE.EMOJI_SET);
  };

  public processJoinChatLink = (link: InternalLink.InternalLinkJoinChat) => {
    return this.managers.appChatInvitesManager.checkChatInvite(link.invite).then(async(chatInvite) => {
      if(chatInvite._ === 'chatInviteAlready' ||
        chatInvite._ === 'chatInvitePeek'/*  && chatInvite.expires > tsNow(true) */) {
        appImManager.open({
          peerId: chatInvite.chat.id.toPeerId(true)
        });
        return;
      }

      return showJoinChatInvitePopup(link.invite, chatInvite as any);
    }, (err: ApiError) => {
      if(err.type === 'INVITE_HASH_EXPIRED') {
        toastNew({langPackKey: 'InviteExpired'});
      }
    });
  };

  /**
   * A chat's video chat or live stream: t.me/<chat>?videochat (?voicechat, ?livestream), tg://resolve?domain=…&videochat,
   * and tg://voicechat?chat_id=…&id=…, the address the "video chat" of a call's service message carries. The chat is
   * opened first; a link then joins only the call running there, the one it names, never a new one, and only once
   * asked (`joinCallFromLink`, as tdesktop's joinVoiceChatFromLink). Only the service message's own anchor joins as
   * the chat's Join button does (tdesktop GroupCallClickHandler): the same address can come from anywhere.
   */
  public processVoiceChatLink = async(
    link: InternalLink.InternalLinkVoiceChat,
    options?: {fromServiceMessage?: boolean}
  ) => {
    let peerId: PeerId;
    if(link.chat_id !== undefined) {
      if(!IS_GROUP_CALL_SUPPORTED || !link.id) {
        return;
      }

      peerId = link.chat_id.toPeerId(true);
    } else if(link.domain) {
      let peer: User | Chat;
      try {
        peer = await this.managers.appUsersManager.resolveUsername(link.domain);
      } catch(err) {
        this.showUsernameResolveError(err as ApiError);
        return;
      }

      // * a call is a chat's: a user's link is the user's (tdesktop shows the peer)
      if(peer._ === 'user') {
        return appImManager.openUsername({userName: link.domain});
      }

      peerId = peer.id.toPeerId(true);
    } else {
      return;
    }

    if(appImManager.chat.peerId !== peerId) {
      await appImManager.setInnerPeer({peerId});
    }

    if(options?.fromServiceMessage) {
      return appImManager.joinGroupCall(peerId, link.id);
    }

    // * ?voicechat=<hash>: a speaker invite, which the join hands over (tdesktop PeerByLinkInfo::voicechatHash)
    const inviteHash = link.livestream ?? link.videochat ?? link.voicechat;
    return appImManager.joinCallFromLink(peerId, link.id, inviteHash || undefined);
  };

  // t.me/call/<slug> handler. Hand the slug to `appImManager.joinConference`,
  // the single conference-join policy entry point — it owns the support gate,
  // the "already in a call" guard and the dead-link error UX (so re-clicking
  // the link while already in the call doesn't rejoin). tdesktop equivalent:
  // SessionNavigation::resolveConferenceCall → startOrJoinConferenceCall.
  public processConferenceCallLink = (
    link: InternalLink.InternalLinkConferenceCall,
    options?: JoinConferenceOptions
  ) => {
    // The slug is an opaque token the server minted; a malformed one is a dead
    // link, and it gets the same notice as an expired one.
    if(typeof(link.slug) !== 'string' || !CONFERENCE_CALL_SLUG_REGEXP.test(link.slug)) {
      toastNew({langPackKey: 'InviteExpired'});
      return Promise.resolve();
    }

    return appImManager.joinConference({_: 'inputGroupCallSlug', slug: link.slug}, options);
  };

  /**
   * Sender of the message a link was clicked in. tdesktop threads the clicked
   * item through the click handler's context and names its sender in the
   * conference join confirmation (window_session_controller.cpp:1023); here
   * the click is the only thread back to that message.
   *
   * A surface that already knows its message says so on the anchor it builds
   * (`getWebPageActionOnClick`) — that covers the buttons which have no
   * rendered message around them, like the pinned bar's Join call. Otherwise
   * the link is text inside a bubble, and the bubble is what identifies it.
   */
  private getClickedMessageSenderPeerId(element?: HTMLElement, event?: Event) {
    const stamped = element?.dataset?.fromId ||
      findUpAttribute(event?.target as HTMLElement, 'data-from-id')?.dataset.fromId;
    if(stamped) {
      return stamped.toPeerId();
    }

    const bubble = findUpClassName(element, 'bubble') ||
      findUpClassName(event?.target as HTMLElement, 'bubble');
    const chat = appImManager.chat;
    if(!bubble || !chat || bubble.dataset.peerId !== '' + chat.peerId) {
      return;
    }

    return chat.getMessage(makeFullMid(chat.peerId, +bubble.dataset.mid))?.fromId;
  }

  public processAddAiStyleLink = async(link: InternalLink.InternalLinkAddAiStyle) => {
    if(this.processingAddAiStyleSlugs.has(link.slug)) return;
    this.processingAddAiStyleSlugs.add(link.slug);

    try {
      const {module: {default: showViewTonePopup}, tone, tones} = await namedPromises({
        module: import('@components/popups/aiEditorPopup/viewTonePopup'),
        tone: this.managers.aiTonesManager.getToneBySlug(link.slug),
        tones: this.managers.aiTonesManager.getTones()
      });
      if(!tone) throw new Error();

      const savedTones = tones.filter((t) => t._ === 'aiComposeTone').length;
      const isSaved = !tone.pFlags.creator && tones.some((t) => t._ === 'aiComposeTone' && t.id.toString() === tone.id.toString());

      showViewTonePopup({
        tone,
        isSaved,
        savedTones,
        HotReloadGuard: SolidJSHotReloadGuardProvider
      });
    } catch{
      toastNew({
        langPackKey: 'AiEditor.StyleNotFound'
      });
    } finally {
      this.processingAddAiStyleSlugs.delete(link.slug);
    }
  };

  // * TeleSignal: a number goes to Signal's contact discovery service only once the user agrees (`lib/signal/signalLinks`)
  public processUserPhoneNumberLink = (link: InternalLink.InternalLinkUserPhoneNumber) => {
    return lookUpPhoneNumber(link.phone, link.text);
  };

  public processInvoiceLink = (link: InternalLink.InternalLinkInvoice) => {
    showUnsupportedLinkToast();
  };

  public processListLink = async(link: InternalLink.InternalLinkAddList) => {
    let chatlistInvite: ChatlistsChatlistInvite;
    try {
      chatlistInvite = await this.managers.filtersStorage.checkChatlistInvite(link.slug);
    } catch(err) {
      if((err as ApiError).type === 'INVITE_SLUG_EXPIRED') {
        toastNew({langPackKey: 'SharedFolder.Link.Expired'});
        return;
      }

      throw err;
    }

    showSharedFolderInvitePopup({
      chatlistInvite,
      slug: link.slug
    });
  };

  public processStoryLink = async(link: InternalLink.InternalLinkStory) => {
    const managers = bindManagersToSession(this.managers);
    const event = window.event;
    const bubble = findUpClassName(event.target as HTMLElement, 'bubble');
    if(bubble && bubble.classList.contains('story')) {
      simulateClickEvent(bubble.querySelector('.media-container').querySelector('img, video'));
      return;
    }

    let peer: User.user | Chat;
    try {
      peer = await managers.appUsersManager.resolveUsername(link.domain);
    } catch(err) {
      if((err as ApiError).type === 'USERNAME_NOT_OCCUPIED') {
        toastNew({langPackKey: 'NoUsernameFound'});
      } else {
        console.error(err);
      }

      return;
    }

    const peerId = peer.id.toPeerId(peer._ !== 'user');
    // * `t.me/<name>/s/live` names the peer's current live stream, not a story id — open the peer's
    // * stories, as tdesktop does
    if(link.story === 'live') {
      const peerStories = await managers.appStoriesManager.getPeerStories(peerId);
      if(!peerStories?.stories.length) {
        toastNew({langPackKey: 'NoStoryFound'});
        return;
      }

      createStoriesViewerWithPeer({peerId});
      return;
    }

    const storyItem = await managers.appStoriesManager.getStoryById(peerId, +link.story);
    if(!storyItem) {
      toastNew({langPackKey: 'NoStoryFound'});
      return;
    }

    createStoriesViewerWithPeer({
      peerId,
      id: +link.story
    });
  };

  public processPremiumFeaturesLink = async(link: InternalLink.InternalLinkPremiumFeatures) => {
    // * TeleSignal: Signal has no Premium to offer
    showUnsupportedLinkToast();
  };

  public processGiftCodeLink = (link: InternalLink.InternalLinkGiftCode) => {
    showUnsupportedLinkToast();
  };

  public processStarsTopupLink = (link: InternalLink.InternalLinkStarsTopup) => {
    showUnsupportedLinkToast();
  };

  public processShareLink = async(link: InternalLink.InternalLinkShare) => {
    const managers = bindManagersToSession(rootScope.managers);
    const {peerId} = await showSharingPicker2Popup();
    // The shared text becomes a draft of the chosen chat — any chat, the way
    // tdesktop's `MainWidget::shareUrl` does it. `setInnerPeer({text})` is the
    // `?text=` deep-link path, which only prefills private chats.
    const text = [link.url, link.text].filter(Boolean).join('\n');
    if(text) {
      await managers.appDraftsManager.setDraft(peerId, undefined, text);
    }

    appImManager.setInnerPeer({peerId});
  };

  public processUniqueStarGiftLink = (link: InternalLink.InternalLinkUniqueStarGift) => {
    showUnsupportedLinkToast();
  };

  public processStarGiftCollectionLink = (link: InternalLink.InternalLinkStarGiftCollection) => {
    showUnsupportedLinkToast();
  };

  public processStoryAlbumLink = async(link: InternalLink.InternalLinkStoryAlbum) => {
    const peer = await this.managers.appUsersManager.resolveUsername(link.domain);
    const peerId = peer.id.toPeerId(peer._ !== 'user');
    const albumId = +link.id;

    if(peerId === rootScope.myId) {
      const existing = appSidebarRight.getTab(AppMyStoriesTab);
      if(existing) {
        (existing as any).setAlbum(albumId);
        return;
      }

      await appSidebarRight.createTab(AppMyStoriesTab).open({...AppMyStoriesTab.getInitArgs(), initialAlbumId: albumId});
      appSidebarRight.toggleSidebar(true, true);
    } else {
      if(appImManager.chat.peerId !== peerId) {
        await appImManager.setInnerPeer({peerId});
        await pause(500);
      }
      appSidebarRight.toggleSidebar(true, true);
      const sharedMediaTab = appSidebarRight.sharedMediaTab;
      await sharedMediaTab.setSearchTab('stories');
      if(appSidebarRight.sharedMediaTab !== sharedMediaTab) return;
      sharedMediaTab.searchSuper.storiesSetAlbum(albumId);
    }
  };

  /**
   * Someone's "My QR code" link: the server makes its owner a contact and names them; a token that
   * has expired, or a user who is gone, is a dead link (tdesktop's `resolveContactToken`).
   */
  public processContactTokenLink = async(link: InternalLink.InternalLinkContactToken) => {
    const managers = bindManagersToSession(this.managers);
    const user = link.token ?
      await managers.appUsersManager.importContactToken(link.token).catch(missUnlessSessionEnded) :
      undefined;
    if(!user || user._ !== 'user' || user.pFlags.deleted) {
      toastNew({langPackKey: 'ContactLinkInvalid'});
      return;
    }

    return appImManager.setInnerPeer({peerId: user.id.toPeerId(false)});
  };

  /**
   * A tg:// link this client does not know: the server is asked about it, and what it has to say is
   * shown (tdesktop's `HandleUnknown`; its offer to update the app is for an installed one). When it
   * has nothing to say, the link may still be another Telegram app's: it is offered to the system the
   * way a plain link went before, on a press of Open: after the lookup the click that brought it here
   * no longer counts as the user's, and the browser would block it.
   */
  public processUnknownDeepLink = async(element: HTMLAnchorElement) => {
    const managers = bindManagersToSession(this.managers);
    // tdesktop asks with what follows `tg://` up to the query
    const path = element.href.replace(/^tg:(?:\/\/)?/i, '').split(/[?#]/)[0];
    const info = await managers.apiManager.getDeepLinkInfo(path).catch(missUnlessSessionEnded);
    if(info && info._ === 'help.deepLinkInfo') {
      return confirmationPopup({
        button: {langKey: 'OK', isCancel: true},
        description: wrapRichText(info.message, {entities: info.entities})
      }).catch(noop);
    }

    this.showOpenUrlAlert(element);
  };

  public processInstantViewLink = (link: InternalLink.InternalLinkInstantView) => {
    openInstantViewInAppBrowser({
      cachedPage: link.url,
      HotReloadGuardProvider: SolidJSHotReloadGuardProvider
    });
  };

  public processInternalLink(link: InternalLink) {
    const map: {
      [key in InternalLink['_']]?: (link: any) => any
    } = {
      [INTERNAL_LINK_TYPE.MESSAGE]: this.processMessageLink,
      [INTERNAL_LINK_TYPE.PRIVATE_POST]: this.processPrivatePostLink,
      [INTERNAL_LINK_TYPE.EMOJI_SET]: this.processStickerSetLink,
      [INTERNAL_LINK_TYPE.STICKER_SET]: this.processStickerSetLink,
      [INTERNAL_LINK_TYPE.JOIN_CHAT]: this.processJoinChatLink,
      [INTERNAL_LINK_TYPE.VOICE_CHAT]: this.processVoiceChatLink,
      [INTERNAL_LINK_TYPE.USER_PHONE_NUMBER]: this.processUserPhoneNumberLink,
      [INTERNAL_LINK_TYPE.INVOICE]: this.processInvoiceLink,
      [INTERNAL_LINK_TYPE.ADD_LIST]: this.processListLink,
      [INTERNAL_LINK_TYPE.STORY]: this.processStoryLink,
      [INTERNAL_LINK_TYPE.PREMIUM_FEATURES]: this.processPremiumFeaturesLink,
      [INTERNAL_LINK_TYPE.GIFT_CODE]: this.processGiftCodeLink,
      [INTERNAL_LINK_TYPE.STARS_TOPUP]: this.processStarsTopupLink,
      [INTERNAL_LINK_TYPE.SHARE]: this.processShareLink,
      [INTERNAL_LINK_TYPE.UNIQUE_STAR_GIFT]: this.processUniqueStarGiftLink,
      [INTERNAL_LINK_TYPE.STAR_GIFT_COLLECTION]: this.processStarGiftCollectionLink,
      [INTERNAL_LINK_TYPE.STORY_ALBUM]: this.processStoryAlbumLink,
      [INTERNAL_LINK_TYPE.INSTANT_VIEW]: this.processInstantViewLink,
      [INTERNAL_LINK_TYPE.CONFERENCE_CALL]: this.processConferenceCallLink,
      [INTERNAL_LINK_TYPE.ADD_AI_STYLE]: this.processAddAiStyleLink,
      [INTERNAL_LINK_TYPE.CONTACT_TOKEN]: this.processContactTokenLink
    };

    const processor = map[link._];
    if(!processor) {
      console.warn('Not supported internal link:', link);
      return;
    }

    return processor(link);
  }
}

// made once: a hot update keeps it and moves it onto the edited class (see @helpers/hotRegistry)
const internalLinkProcessor = new InternalLinkProcessor();
MOUNT_CLASS_TO && (MOUNT_CLASS_TO.internalLinkProcessor = internalLinkProcessor);
registerHotReloadGuard({internalLinkProcessor});
export default internalLinkProcessor;

if(import.meta.hot) import.meta.hot.accept();
