/*
 * TeleSignal: Web K on the Signal engine.
 *
 * The managers of Web K were written for Telegram's API, which this app does not use: `ApiManager.invokeApi` hands
 * every method to `invoke` here, which answers it from the Signal provider that Web A uses as well
 * (`@signal-app/provider`, `src/api/signal` of the repository), in Telegram's shapes (`@lib/signal/builders`). The
 * provider's updates come back as Telegram updates through `apiUpdatesManager`. The engine keeps the account,
 * messages and attachments in its own stores, which both frontends open, so the managers' caches only mirror them.
 */

import type {
  Chat,
  Dialog,
  InputDialogPeer,
  InputPeer,
  InputUser,
  Message,
  MessagesDialogs,
  MessagesMessages,
  MethodDeclMap,
  Peer,
  Update,
  Updates,
  User
} from '@layer';
import type {
  SignalApiUpdate,
  SignalChat,
  SignalChats,
  SignalInitialArgs,
  SignalMessage,
  SignalReactions,
  SignalUser
} from '@lib/signal/signalApi';
import {AppManager} from '@appManagers/manager';
import {buildChat, buildDialog, buildMessage, buildPeer, buildPeerReaction, buildUser, isGroupPeerId, toPeerId, toSignalPeerId} from '@lib/signal/builders';
import {DEFAULT_REACTION_EMOJIS, buildReaction, toSignalReaction} from '@lib/signal/reactions';
import {buildChatMethodHandlers} from '@lib/signal/chatMethods';
import {getErrorLangKey} from '@lib/signal/errors';
import {buildGroupMethodHandlers} from '@lib/signal/groupMethods';
import {buildAccountMethodHandlers} from '@lib/signal/accountMethods';
import {buildUserMethodHandlers, fetchSafetyNumber, updateSafetyNumberVerified} from '@lib/signal/userMethods';
import {buildPinnedMessageHandlers, buildPinnedMessagesUpdate, fetchPinnedMessages} from '@lib/signal/pinnedMessages';
import {fetchMessageRecipients} from '@lib/signal/messageInfo';
import {buildSharedMediaHandlers, getSearchType} from '@lib/signal/sharedMedia';
import type {SignalMethodHost} from '@lib/signal/methodHost';
import {getSignalWorkerAccountNumber} from '@lib/signal/accountSlot';
import type {SignalAuthState} from '@lib/signal/registrationTypes';
import makeError from '@helpers/makeError';
import noop from '@helpers/noop';
import {ConnectionStatus} from '@lib/mtproto/connectionStatus';
import tsNow from '@helpers/tsNow';
import deferredPromise, {CancellablePromise} from '@helpers/cancellablePromise';

export type SignalLinkCode = {url: string, expires: number};

type SignalSearchResult = {messages: SignalMessage[], totalCount: number, nextOffsetId?: number};

type MethodHandler = (params: any) => Promise<any> | any;

type PendingSend = {
  randomId: string,
  deferred: CancellablePromise<Updates>
};

const UNSUPPORTED_ERROR = 'SIGNAL_METHOD_UNSUPPORTED';
const emptySearchResult = () => ({_: 'messages.messages', messages: [], chats: [], users: [], topics: []} as MethodDeclMap['messages.search']['res']);
// * `ApiManager.getBaseDcId`: Web K's code expects the account's data center
const SIGNAL_DC_ID = 2;
const DIALOGS_PAGE_LIMIT = 100;
// * the provider's local ids of messages being sent: the chat's last id plus a fraction, as Web A makes them
const LOCAL_ID_STEP = 1e-4;
// * a sent message replaces its local one in Web K once the engine stored it, which takes no network round trip
const SEND_TIMEOUT_MS = 60e3;

let provider: Promise<typeof import('@signal-app/provider')>;

export default class AppSignalManager extends AppManager {
  private linkCode: SignalLinkCode;
  private isStarted: boolean;
  private isAuthorized: boolean;
  private restarting: Promise<void>;
  private authState: SignalAuthState;
  private pendingSends: Map<number, PendingSend> = new Map();
  // * the `random_id` of each forwarded copy by its local id, until the engine stores the copy
  private pendingForwardCopies: Map<number, string> = new Map();
  private localIdCounter = 0;
  private handlers: {[method in keyof MethodDeclMap]?: MethodHandler};

  constructor() {
    super();
    this.name = 'SIGNAL';
    this.handlers = this.createHandlers();
  }

  /**
   * Starts the engine of this account slot, or takes it over from the other frontend's tab that runs it (the
   * engine lock in `src/lib/signal/engineOwnership.ts`). Called by every tab that opens, after its passcode check.
   */
  public async start(args: Omit<SignalInitialArgs, 'userAgent'>) {
    // * one engine per worker: the worker of each slot runs that slot's engine (`lib/signal/accountSlot`)
    if(this.getAccountNumber() !== getSignalWorkerAccountNumber()) {
      return;
    }

    const {initApi} = await getProvider();
    this.isStarted = true;
    await initApi(this.onUpdate, {...args, userAgent: navigator.userAgent});
  }

  /**
   * Starts the engine again with new arguments, such as other proxy servers, as Web A's `reconnectApi` does. Restarts
   * run one after another, so the last one asked for is the one the engine ends with.
   */
  public restart(args: Omit<SignalInitialArgs, 'userAgent'>) {
    const restarting = (this.restarting || Promise.resolve()).catch(noop).then(async() => {
      if(this.isStarted) {
        await this.call('destroy', true);
      }

      await this.start(args);
    });
    this.restarting = restarting;
    return restarting;
  }

  public getLinkCode() {
    return this.linkCode;
  }

  /** The safety number of a user for the popup of Web K (`components/popups/safetyNumber.ts`) */
  public fetchSafetyNumber(userId: PeerId) {
    return fetchSafetyNumber(this.createMethodHost(), userId);
  }

  public updateSafetyNumberVerified(userId: PeerId, isVerified: boolean) {
    return updateSafetyNumberVerified(this.createMethodHost(), userId, isVerified);
  }

  /** The recipients of an outgoing message for the message info popup (`components/popups/messageInfo.tsx`) */
  public fetchMessageRecipients(peerId: PeerId, mid: number) {
    return fetchMessageRecipients(this.createMethodHost(), peerId, mid);
  }

  public invoke<T extends keyof MethodDeclMap>(method: T, params: MethodDeclMap[T]['req']): Promise<MethodDeclMap[T]['res']> {
    const handler = this.handlers[method];
    if(!handler) {
      this.log.warn('unsupported method', method, params);
      return Promise.reject(makeError(UNSUPPORTED_ERROR as ErrorType));
    }

    return Promise.resolve().then(() => handler(params));
  }

  /**
   * Unlinks this device and forgets the account, its messages and attachments, as Web A's sign-out does; settles once
   * the unlink request is answered or has failed and the engine's stores are cleared
   */
  public async logOut() {
    if(!this.isStarted) {
      return;
    }

    await this.call('destroy');
    this.isStarted = false;
    this.isAuthorized = false;
  }

  /** A provider method that the settings screens call, run by the engine of this worker (`lib/signal/settingsApi`) */
  public callSignal(name: string, ...args: any[]) {
    return this.call(name, ...args);
  }

  private async call<T = any>(name: string, ...args: any[]): Promise<T> {
    const {callApi} = await getProvider();
    return callApi(name, ...args);
  }

  /* ---------- methods ---------- */

  private createHandlers(): AppSignalManager['handlers'] {
    const now = () => tsNow(true);
    const emptyMessages = () => ({_: 'messages.messages', messages: [] as Message[], chats: [] as Chat[], users: [] as User[], topics: [] as any[]});
    const emptyUpdates = () => ({_: 'updates', updates: [] as Update[], users: [] as User[], chats: [] as Chat[], date: now(), seq: 0});
    const host = this.createMethodHost();
    return {
      'help.getConfig': () => this.getConfig(),
      'help.getAppConfig': () => ({_: 'help.appConfig', hash: 1, config: {_: 'jsonObject', value: []}}),
      'help.getNearestDc': () => ({_: 'nearestDc', country: '', this_dc: 2, nearest_dc: 2}),
      'help.getPeerColors': () => ({_: 'help.peerColors', hash: 1, colors: []}),
      'help.getPeerProfileColors': () => ({_: 'help.peerColors', hash: 1, colors: []}),
      'help.getTimezonesList': () => ({_: 'help.timezonesList', timezones: [], hash: 0}),
      'help.getPromoData': () => ({_: 'help.promoDataEmpty', expires: now() + 86400}),
      'help.getCountriesList': () => ({_: 'help.countriesList', countries: [], hash: 0}),
      'help.getPremiumPromo': () => Promise.reject(makeError(UNSUPPORTED_ERROR as ErrorType)),
      'updates.getState': () => ({_: 'updates.state', pts: 1, qts: 0, date: now(), seq: 1, unread_count: 0}),
      'updates.getDifference': () => ({_: 'updates.differenceEmpty', date: now(), seq: 1}),
      'account.updateStatus': () => true,
      'account.getContentSettings': () => ({_: 'account.contentSettings', pFlags: {}}),
      'account.getGlobalPrivacySettings': () => ({_: 'globalPrivacySettings', pFlags: {}}),
      'account.registerDevice': () => true,
      'account.unregisterDevice': () => true,
      'langpack.getLangPack': () => Promise.reject(makeError(UNSUPPORTED_ERROR as ErrorType)),
      'langpack.getDifference': () => Promise.reject(makeError(UNSUPPORTED_ERROR as ErrorType)),
      'messages.getDialogFilters': () => ({_: 'messages.dialogFilters', pFlags: {}, filters: [{_: 'dialogFilterDefault'}]}),
      'messages.getSuggestedDialogFilters': () => [],
      'messages.getDialogs': (params) => this.getDialogs(params),
      'messages.getPinnedDialogs': (params) => this.getPinnedDialogs(params),
      'messages.getPeerDialogs': (params) => this.getPeerDialogs(params),
      'messages.getHistory': (params) => this.getHistory(params),
      'messages.sendMessage': (params) => this.sendMessage(params),
      'messages.readHistory': (params) => this.readHistory(params),
      'messages.setTyping': (params) => this.setTyping(params),
      'messages.deleteMessages': (params) => this.deleteMessages(params),
      'messages.sendReaction': (params) => this.sendReaction(params),
      'messages.getMessagesReactions': () => ({_: 'updates', updates: [], users: [], chats: [], date: now(), seq: 0}),
      'messages.getMessageReactionsList': (params) => this.getMessageReactionsList(params),
      'messages.forwardMessages': (params) => this.forwardMessages(params),
      'messages.editMessage': (params) => this.editMessage(params),
      'messages.getChats': (params) => this.getChats(params),
      'messages.getMessages': emptyMessages,
      'messages.search': (params) => this.searchMessages(params),
      'messages.searchGlobal': (params) => this.searchGlobal(params),
      // * Signal has no threads or saved dialogs: they answer with nothing, as for a new chat
      'messages.getReplies': emptyMessages,
      'messages.getSavedHistory': emptyMessages,
      'messages.receivedMessages': () => [],
      'messages.getAllDrafts': emptyUpdates,
      'messages.getAttachMenuBots': () => ({_: 'attachMenuBots', hash: 0, bots: [], users: []}),
      // * Signal's stickers and reactions are not in these lists yet
      'messages.getEmojiStickers': () => ({_: 'messages.allStickers', hash: 0, sets: []}),
      'messages.getAllStickers': () => ({_: 'messages.allStickers', hash: 0, sets: []}),
      'messages.getStickers': () => ({_: 'messages.stickers', hash: 0, stickers: []}),
      'messages.getFeaturedStickers': () => ({_: 'messages.featuredStickers', pFlags: {}, hash: 0, count: 0, sets: [], unread: []}),
      'messages.getFavedStickers': () => ({_: 'messages.favedStickers', hash: 0, packs: [], stickers: []}),
      'messages.getRecentStickers': () => ({_: 'messages.recentStickers', hash: 0, packs: [], stickers: [], dates: []}),
      'messages.getSavedGifs': () => ({_: 'messages.savedGifs', hash: 0, gifs: []}),
      'messages.getAvailableReactions': () => ({_: 'messages.availableReactions', hash: 0, reactions: []}),
      'messages.getTopReactions': () => ({_: 'messages.reactions', hash: 0, reactions: DEFAULT_REACTION_EMOJIS.map((emoticon) => buildReaction({type: 'emoji', emoticon}))}),
      'messages.getRecentReactions': () => ({_: 'messages.reactions', hash: 0, reactions: []}),
      'contacts.getBirthdays': () => ({_: 'contacts.contactBirthdays', contacts: [], users: []}),
      'account.getAuthorizations': () => ({_: 'account.authorizations', authorization_ttl_days: 0, authorizations: []}),
      'photos.getUserPhotos': () => ({_: 'photos.photos', photos: [], users: []}),
      'stories.getAllReadPeerStories': emptyUpdates,
      'stories.getPinnedStories': () => ({_: 'stories.stories', pFlags: {}, count: 0, stories: [], chats: [], users: [], pinned_to_top: []}),
      'messages.getScheduledHistory': () => ({_: 'messages.messages', messages: [], chats: [], users: [], topics: []}),
      'messages.getSavedDialogs': () => ({_: 'messages.savedDialogs', dialogs: [], messages: [], chats: [], users: []}),
      'messages.getStickerSet': () => Promise.reject(makeError('STICKERSET_INVALID' as ErrorType)),
      'users.getUsers': (params) => this.getUsers(params),
      'contacts.getContacts': () => this.getContacts(),
      'contacts.getTopPeers': () => ({_: 'contacts.topPeersDisabled'}),
      'stories.getAllStories': () => ({
        _: 'stories.allStories',
        pFlags: {},
        count: 0,
        state: '',
        peer_stories: [],
        chats: [],
        users: [],
        stealth_mode: {_: 'storiesStealthMode', pFlags: {}}
      }),
      ...buildChatMethodHandlers(host),
      ...buildGroupMethodHandlers(host),
      ...buildUserMethodHandlers(host),
      ...buildPinnedMessageHandlers(host),
      ...buildSharedMediaHandlers(host),
      ...buildAccountMethodHandlers(host)
    };
  }

  /** What the method handlers of `src/lib/signal` reach: the provider and the managers of Web K */
  private createMethodHost(): SignalMethodHost {
    return {
      call: (name, ...args) => this.call(name, ...args),
      getInputPeerId: (inputPeer) => this.getInputPeerId(inputPeer),
      getManagers: () => ({
        appChatsManager: this.appChatsManager,
        appPeersManager: this.appPeersManager
      })
    };
  }

  private getConfig() {
    const now = tsNow(true);
    return {
      _: 'config',
      pFlags: {},
      date: now,
      expires: now + 3600,
      test_mode: false,
      this_dc: 2,
      dc_options: [],
      dc_txt_domain_name: '',
      chat_size_max: 1000,
      megagroup_size_max: 1000,
      forwarded_count_max: 100,
      online_update_period_ms: 210000,
      offline_blur_timeout_ms: 5000,
      offline_idle_timeout_ms: 30000,
      online_cloud_timeout_ms: 300000,
      notify_cloud_delay_ms: 30000,
      notify_default_delay_ms: 1500,
      push_chat_period_ms: 60000,
      push_chat_limit: 2,
      // * Signal Android: messages can be edited and deleted for everyone for 24 hours
      edit_time_limit: 86400,
      revoke_time_limit: 86400,
      revoke_pm_time_limit: 86400,
      rating_e_decay: 2419200,
      stickers_recent_limit: 200,
      channels_read_media_period: 604800,
      call_receive_timeout_ms: 20000,
      call_ring_timeout_ms: 90000,
      call_connect_timeout_ms: 30000,
      call_packet_timeout_ms: 10000,
      me_url_prefix: '',
      caption_length_max: 4096,
      message_length_max: 4096,
      webfile_dc_id: 2
    } as MethodDeclMap['help.getConfig']['res'];
  }

  private async getDialogs(params: MethodDeclMap['messages.getDialogs']['req']): Promise<MessagesDialogs> {
    const offsetPeerId = this.getInputPeerId(params.offset_peer);
    const isFirstPage = !params.offset_date && !offsetPeerId;
    const result: SignalChats = await this.call('fetchChats', {
      limit: params.limit || DIALOGS_PAGE_LIMIT,
      offsetDate: isFirstPage ? undefined : params.offset_date,
      offsetPeer: isFirstPage || !offsetPeerId ? undefined : {id: toSignalPeerId(offsetPeerId)},
      archived: params.folder_id === 1,
      withPinned: isFirstPage
    });

    if(!result) {
      return {_: 'messages.dialogs', dialogs: [], messages: [], chats: [], users: []};
    }

    const built = this.buildChats(result);
    return {
      _: 'messages.dialogsSlice',
      count: result.isFullyLoaded && isFirstPage ? built.dialogs.length : result.totalChatCount,
      ...built
    };
  }

  private async getPinnedDialogs(params: MethodDeclMap['messages.getPinnedDialogs']['req']) {
    const result: SignalChats = await this.call('fetchChats', {
      limit: 0,
      archived: params.folder_id === 1,
      withPinned: true
    });

    const built = result ? this.buildChats(result) : {dialogs: [] as Dialog[], messages: [] as Message[], chats: [] as Chat[], users: [] as User[]};
    return {
      _: 'messages.peerDialogs',
      ...built,
      dialogs: built.dialogs.filter((dialog) => dialog.pFlags.pinned),
      state: {_: 'updates.state', pts: 1, qts: 0, date: tsNow(true), seq: 1, unread_count: 0}
    } as MethodDeclMap['messages.getPinnedDialogs']['res'];
  }

  private async getPeerDialogs(params: MethodDeclMap['messages.getPeerDialogs']['req']) {
    const peerIds = new Set(params.peers.map((peer: InputDialogPeer) => {
      return peer._ === 'inputDialogPeer' ? this.getInputPeerId(peer.peer) : undefined;
    }));
    const [main, archived]: SignalChats[] = await Promise.all([
      this.call('fetchChats', {limit: Number.MAX_SAFE_INTEGER, withPinned: true}),
      this.call('fetchChats', {limit: Number.MAX_SAFE_INTEGER, archived: true, withPinned: true})
    ]);

    const dialogs: Dialog[] = [];
    const messages: Message[] = [];
    const chats: Chat[] = [];
    const users: User[] = [];
    [main, archived].filter(Boolean).forEach((result) => {
      const built = this.buildChats(result);
      built.dialogs.forEach((dialog) => {
        if(peerIds.has(getPeerIdOfPeer(dialog.peer))) {
          dialogs.push(dialog);
        }
      });
      messages.push(...built.messages);
      chats.push(...built.chats);
      users.push(...built.users);
    });

    return {
      _: 'messages.peerDialogs',
      dialogs,
      messages,
      chats,
      users,
      state: {_: 'updates.state', pts: 1, qts: 0, date: tsNow(true), seq: 1, unread_count: 0}
    } as MethodDeclMap['messages.getPeerDialogs']['res'];
  }

  private buildChats(result: SignalChats) {
    const pinnedIds = new Set(result.orderedPinnedIds);
    const chatsById = new Map(result.chats.map((chat) => [chat.id, chat]));
    const dialogs = result.chatIds.map((chatId) => buildDialog({
      chat: chatsById.get(chatId),
      readState: result.threadReadStatesById[chatId],
      topMessageId: result.lastMessageByChatId[chatId],
      notifySettings: result.notifyExceptionById[chatId],
      isPinned: pinnedIds.has(chatId)
    }));

    // * the notices that name people are built with their names
    const users = result.users.map(buildUser);
    this.appUsersManager.saveApiUsers(users);
    return {
      dialogs,
      messages: result.messages.map(this.buildMessage),
      chats: result.chats.filter((chat) => isGroupPeerId(chat.id)).map(buildChat),
      users
    };
  }

  private async getHistory(params: MethodDeclMap['messages.getHistory']['req']): Promise<MessagesMessages> {
    const peerId = this.getInputPeerId(params.peer);
    const result: {messages: SignalMessage[], users: SignalUser[], count: number} = await this.call('fetchMessages', {
      chat: {id: toSignalPeerId(peerId)},
      offsetId: params.offset_id || undefined,
      addOffset: params.add_offset || 0,
      limit: params.limit
    });

    if(!result) {
      return {_: 'messages.messages', messages: [], chats: [], users: [], topics: []};
    }

    const chats = await this.getChatsOfPeer(peerId);
    const users = result.users.map(buildUser);
    this.appUsersManager.saveApiUsers(users);
    return {
      _: 'messages.messagesSlice',
      pFlags: {},
      count: result.count,
      messages: result.messages.map(this.buildMessage),
      chats,
      users,
      topics: []
    };
  }

  private async getChatsOfPeer(peerId: PeerId): Promise<Chat[]> {
    if(!isGroupPeerId(peerId)) {
      return [];
    }

    const chat = this.appChatsManager.getChat((-peerId) as ChatId);
    return chat ? [chat] : [];
  }

  private sendMessage(params: MethodDeclMap['messages.sendMessage']['req']): Promise<Updates> {
    const peerId = this.getInputPeerId(params.peer);
    const replyTo = params.reply_to?._ === 'inputReplyToMessage' ? params.reply_to.reply_to_msg_id : undefined;
    const lastMessageId = this.appMessagesManager.getHistoryStorage(peerId.toPeerId()).maxId || 0;
    const localId = this.nextLocalId(lastMessageId);
    const chatId = toSignalPeerId(peerId);
    const entities = (params.entities || []).map((entity) => this.buildSignalEntity(entity)).filter(Boolean);
    const localMessage: SignalMessage = {
      id: localId,
      chatId,
      content: {text: {text: params.message, entities}},
      date: tsNow(true),
      isOutgoing: true,
      replyInfo: replyTo ? {type: 'message', replyToMsgId: replyTo} : undefined
    };

    const deferred = deferredPromise<Updates>();
    this.pendingSends.set(localId, {randomId: '' + params.random_id, deferred});
    const timeout = setTimeout(() => {
      this.pendingSends.delete(localId);
      deferred.reject(makeError('SIGNAL_SEND_TIMEOUT' as ErrorType));
    }, SEND_TIMEOUT_MS);
    deferred.finally(() => clearTimeout(timeout));

    this.call('sendMessage', {
      chat: {id: chatId},
      text: params.message,
      entities,
      replyInfo: localMessage.replyInfo,
      lastMessageId,
      localMessage
    }).catch((err) => {
      this.pendingSends.delete(localId);
      deferred.reject(err);
    });

    return deferred;
  }

  private async readHistory(params: MethodDeclMap['messages.readHistory']['req']) {
    await this.call('markMessageListRead', {chat: {id: toSignalPeerId(this.getInputPeerId(params.peer))}, threadId: -1, maxId: params.max_id});
    return {_: 'messages.affectedMessages', pts: 0, pts_count: 0};
  }

  private async setTyping(params: MethodDeclMap['messages.setTyping']['req']) {
    const type = params.action._ === 'sendMessageTypingAction' ? 'typing' : (params.action._ === 'sendMessageCancelAction' ? 'cancel' : undefined);
    if(type) {
      await this.call('sendMessageAction', {peer: {id: toSignalPeerId(this.getInputPeerId(params.peer))}, action: {type}});
    }

    return true;
  }

  private async deleteMessages(params: MethodDeclMap['messages.deleteMessages']['req']) {
    await this.call('deleteMessages', {messageIds: params.id, shouldDeleteForAll: params.revoke});
    return {_: 'messages.affectedMessages', pts: 0, pts_count: 0};
  }

  private async editMessage(params: MethodDeclMap['messages.editMessage']['req']) {
    const peerId = this.getInputPeerId(params.peer);
    await this.call('editMessage', {
      chat: {id: toSignalPeerId(peerId)},
      message: {id: params.id, chatId: toSignalPeerId(peerId)},
      text: params.message,
      entities: (params.entities || []).map((entity) => this.buildSignalEntity(entity)).filter(Boolean)
    });
    // * the edit comes back as an update once the engine stored it
    return {_: 'updates', updates: [], users: [], chats: [], date: tsNow(true), seq: 0} as Updates;
  }

  /** Signal keeps one reaction per person: the last of `reaction` is ours, none takes ours back */
  private async sendReaction(params: MethodDeclMap['messages.sendReaction']['req']) {
    const reactions = (params.reaction || []).map(toSignalReaction).filter((reaction) => reaction !== undefined);
    await this.call('sendReaction', {chat: {id: toSignalPeerId(this.getInputPeerId(params.peer))}, messageId: params.msg_id, reactions});
    return {_: 'updates', updates: [], users: [], chats: [], date: tsNow(true), seq: 0} as Updates;
  }

  private async getMessageReactionsList(params: MethodDeclMap['messages.getMessageReactionsList']['req']) {
    const result: {reactions: NonNullable<SignalReactions['recentReactions']>, count: number} = await this.call('fetchMessageReactionsList', {
      chat: {id: toSignalPeerId(this.getInputPeerId(params.peer))},
      messageId: params.id,
      reaction: params.reaction ? toSignalReaction(params.reaction) : undefined
    });
    if(!result) return undefined;

    return {
      _: 'messages.messageReactionsList',
      count: result.count,
      reactions: result.reactions.map(buildPeerReaction),
      chats: [],
      users: result.reactions.map(({peerId}) => this.appUsersManager.getUser(toPeerId(peerId))).filter(Boolean)
    } as MethodDeclMap['messages.getMessageReactionsList']['res'];
  }

  /**
   * Forwards each message as a new one. Every copy has a local id that is registered with the `random_id` of its
   * pending copy before the engine stores it, so the copy's `updateMessageID` goes out with its message, first: Web K
   * finalizes a pending copy only when the id comes before the message. A copy that is not sent fails the request,
   * which marks the pending copies of the request as failed.
   */
  private async forwardMessages(params: MethodDeclMap['messages.forwardMessages']['req']): Promise<Updates> {
    const fromChat = {id: toSignalPeerId(this.getInputPeerId(params.from_peer))};
    const toPeer = this.getInputPeerId(params.to_peer);
    const toChat = {id: toSignalPeerId(toPeer)};
    const messages: SignalMessage[] = await this.call('fetchMessagesById', {chat: fromChat, messageIds: params.id});
    if(messages?.length !== params.id.length) {
      throw makeError('SIGNAL_SEND_FAILED' as ErrorType);
    }

    const lastMessageId = this.appMessagesManager.getHistoryStorage(toPeer).maxId || 0;
    const localIds = params.id.map(() => this.nextLocalId(lastMessageId));
    localIds.forEach((localId, index) => this.pendingForwardCopies.set(localId, '' + params.random_id[index]));
    // * each copy leaves the map with its own sent or failed update, which may come after the call returns
    const storedIds: (number | undefined)[] = await this.call('forwardMessages', {
      fromChat,
      toChat,
      messages,
      noCaptions: params.drop_media_captions,
      lastMessageId,
      localIds
    }).catch((err) => {
      // * a call that failed may have left copies with no update to come
      setTimeout(() => localIds.forEach((localId) => this.pendingForwardCopies.delete(localId)), SEND_TIMEOUT_MS);
      throw err;
    });
    if(!storedIds?.every((id) => id !== undefined)) {
      throw makeError('SIGNAL_SEND_FAILED' as ErrorType);
    }

    return {_: 'updates', updates: [], users: [], chats: [], date: tsNow(true), seq: 0} as Updates;
  }

  /** The text and shared media search of a chat, and its pinned messages */
  private async searchMessages(params: MethodDeclMap['messages.search']['req']) {
    const peerId = this.getInputPeerId(params.peer);
    if(peerId && params.filter?._ === 'inputMessagesFilterPinned') {
      const messages = await fetchPinnedMessages(this.createMethodHost(), peerId);
      return this.buildSearchResult({messages, totalCount: messages.length});
    }

    const fromPeerId = params.from_id ? this.getInputPeerId(params.from_id) : undefined;
    const type = getSearchType(params.filter);
    if(!peerId || !type) return emptySearchResult();

    const result: SignalSearchResult = await this.call('searchMessagesInChat', {
      peer: {id: toSignalPeerId(peerId)},
      type,
      query: params.q,
      limit: params.limit,
      offsetId: params.offset_id || undefined,
      fromPeer: fromPeerId ? {id: toSignalPeerId(fromPeerId)} : undefined
    });
    return this.buildSearchResult(result);
  }

  /** The text and shared media search of all listed chats; `next_rate` carries the offset of the next page */
  private async searchGlobal(params: MethodDeclMap['messages.searchGlobal']['req']) {
    const type = getSearchType(params.filter);
    if(!type) return emptySearchResult();

    const result: SignalSearchResult = await this.call('searchMessagesGlobal', {
      type,
      query: params.q,
      limit: params.limit,
      offsetId: params.offset_rate || params.offset_id || undefined
    });
    return this.buildSearchResult(result);
  }

  private buildSearchResult(result: SignalSearchResult | undefined) {
    if(!result) return emptySearchResult();

    const chatIds = new Set(result.messages.map(({chatId}) => chatId).filter(isGroupPeerId));
    return {
      _: 'messages.messagesSlice',
      pFlags: {},
      count: result.totalCount,
      messages: result.messages.map(this.buildMessage),
      chats: [...chatIds].map((chatId) => this.appChatsManager.getChat((-toPeerId(chatId)) as ChatId)).filter(Boolean),
      users: [],
      topics: [],
      next_rate: result.nextOffsetId
    } as MethodDeclMap['messages.search']['res'];
  }

  private async getChats(params: MethodDeclMap['messages.getChats']['req']) {
    return {
      _: 'messages.chats',
      chats: params.id.map((id) => this.appChatsManager.getChat(id)).filter(Boolean)
    } as MethodDeclMap['messages.getChats']['res'];
  }

  private async getUsers(params: MethodDeclMap['users.getUsers']['req']) {
    const result: {users: SignalUser[]} = await this.call('fetchUsers', {
      users: params.id.map((inputUser) => ({id: toSignalPeerId(this.getInputUserId(inputUser))}))
    });
    return (result?.users || []).map(buildUser);
  }

  private async getContacts() {
    const result: {users: SignalUser[]} = await this.call('fetchContactList');
    const users = (result?.users || []).map(buildUser);
    return {
      _: 'contacts.contacts',
      contacts: users.map((user) => ({_: 'contact', user_id: user.id, mutual: false})),
      saved_count: 0,
      users
    } as MethodDeclMap['contacts.getContacts']['res'];
  }

  private buildMessage = (message: SignalMessage) => buildMessage(message, (signalUserId) => {
    const user = this.appUsersManager.getUser(toPeerId(signalUserId));
    return user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : '';
  });

  private getInputPeerId(inputPeer: InputPeer): PeerId {
    switch(inputPeer?._) {
      case 'inputPeerSelf':
        return this.appPeersManager.peerId;
      case 'inputPeerUser':
        return (+inputPeer.user_id) as PeerId;
      case 'inputPeerChat':
        return (-inputPeer.chat_id) as PeerId;
      default:
        return undefined;
    }
  }

  /* ---------- updates ---------- */

  private onUpdate = (update: SignalApiUpdate) => {
    try {
      this.handleUpdate(update);
    } catch(err) {
      this.log.error('update failed', update, err);
    }
  };

  private handleUpdate(update: SignalApiUpdate) {
    switch(update['@type']) {
      case 'updateBackupSettings':
        // * a backup under way reports its steps, which the backup settings show (`tabs/backups`)
        this.rootScope.dispatchEvent('signal_backup_settings', update.settings);
        break;
      case 'updateAuthorizationError':
        this.rootScope.dispatchEvent('signal_auth_error', update.errorKey);
        break;
      case 'updateAuthorizationState':
        this.onAuthorizationState(update);
        break;
      case 'updateConnectionState':
        this.onConnectionState(update.connectionState);
        break;
      case 'error': {
        // * a change the provider refused (a group change offline, a pin over the list's limit) says so here
        const langPackKey = getErrorLangKey(update.error?.message);
        if(langPackKey) this.rootScope.dispatchEvent('signal_error', langPackKey);
        break;
      }
      case 'updateCurrentUser':
        this.onCurrentUser(update.currentUser);
        break;
      case 'updateEntities':
        if(update.users) {
          this.appUsersManager.saveApiUsers(Object.values(update.users as Record<string, SignalUser>).map(buildUser));
        }
        if(update.chats) {
          this.saveChats(Object.values(update.chats as Record<string, SignalChat>));
        }
        break;
      case 'updateUser':
        if(update.user) {
          this.appUsersManager.saveApiUsers([buildUser({...this.getCachedUser(update.id), ...update.user, id: update.id})]);
        }
        break;
      case 'updateChat':
        if(update.chat) {
          this.saveChats([update.chat]);
        }
        break;
      case 'newMessage':
        // * Web K shows its own message while one is sent: the provider's local one has a fractional id
        if(Number.isInteger(update.message.id)) {
          this.pushUpdates([{_: 'updateNewMessage', message: this.buildMessage(update.message), pts: 0, pts_count: 0}]);
        }
        break;
      case 'updateMessage':
        if(update.message?.content && update.message.chatId) {
          this.pushUpdates([{_: 'updateEditMessage', message: this.buildMessage(update.message as SignalMessage), pts: 0, pts_count: 0}]);
        }
        break;
      case 'updateMessageSendSucceeded':
        this.onMessageSent(update.localId, update.message);
        break;
      case 'updateMessageSendFailed':
        this.onMessageSendFailed(update.localId);
        break;
      case 'deleteMessages':
        this.pushUpdates([{_: 'updateDeleteMessages', messages: update.ids, pts: 0, pts_count: 0}]);
        break;
      case 'updatePinnedIds':
        this.pushUpdates([buildPinnedMessagesUpdate(update.chatId, update.messageIds, update.isPinned)]);
        break;
      case 'updateThreadReadState':
        this.onReadState(update.chatId, update.readState);
        break;
      case 'updateChatTypingStatus':
        this.onTyping(update.id, update.peerId, !!update.typingStatus);
        break;
      case 'updateChatNotifySettings':
        this.pushUpdates([{
          _: 'updateNotifySettings',
          peer: {_: 'notifyPeer', peer: buildPeer(update.chatId)},
          notify_settings: {_: 'peerNotifySettings', mute_until: update.settings?.mutedUntil}
        }]);
        break;
      case 'updatePinnedChatIds':
        this.pushUpdates([{
          _: 'updatePinnedDialogs',
          folder_id: update.folderId === 1 ? 1 : 0,
          order: (update.ids as string[]).map((id) => ({_: 'dialogPeer', peer: buildPeer(id)}))
        }]);
        break;
      default:
        break;
    }
  }

  /** The sign-in step the engine is at, for the link and registration screens (`pages/signalRegistration`) */
  public getAuthState() {
    return this.authState;
  }

  private onAuthorizationState(update: SignalApiUpdate) {
    this.authState = {
      state: update.authorizationState,
      codeInfo: update.codeInfo,
      backupRestore: update.backupRestore
    };
    this.rootScope.dispatchEvent('signal_auth_state', this.authState);

    if(update.authorizationState === 'authorizationStateWaitQrCode' && update.qrCode) {
      this.linkCode = {url: update.qrCode.token, expires: update.qrCode.expires};
      this.rootScope.dispatchEvent('signal_link_code', this.linkCode);
    } else if(update.authorizationState === 'authorizationStateReady') {
      this.linkCode = undefined;
    }
  }

  /** The chat connection of the engine, which Web K shows as the connection of its main data center */
  private onConnectionState(state: string) {
    const status = state === 'connectionStateReady' ? ConnectionStatus.Connected : (
      state === 'connectionStateBroken' ? ConnectionStatus.Closed : ConnectionStatus.Connecting
    );
    this.rootScope.dispatchEvent('connection_status_change', {
      _: 'networkerStatus',
      status,
      dcId: SIGNAL_DC_ID,
      name: 'NET-' + SIGNAL_DC_ID,
      isFileNetworker: false,
      isFileDownload: false,
      isFileUpload: false
    });
  }

  /** The account is linked and its session runs: the user it shows from now on is ours */
  private onCurrentUser(signalUser: SignalUser) {
    const user = buildUser({...signalUser, isSelf: true});
    this.appUsersManager.saveApiUsers([user]);
    if(this.isAuthorized) {
      return;
    }

    this.isAuthorized = true;
    // * a page that shows the link screen goes on to the chats once the slot holds the account (`signal_authorized`)
    this.apiManager.setUser(user).then(() => {
      this.rootScope.dispatchEvent('signal_authorized', user.id.toUserId());
    });
  }

  private getCachedUser(userId: string): Partial<SignalUser> {
    const user = this.appUsersManager.getUser(toPeerId(userId));
    return user ? {
      firstName: user.first_name,
      lastName: user.last_name,
      phoneNumber: user.phone,
      isSelf: user.pFlags.self
    } : {};
  }

  private saveChats(chats: SignalChat[]) {
    this.appChatsManager.saveApiChats(chats.filter((chat) => isGroupPeerId(chat.id)).map(buildChat));
  }

  private pushUpdates(updates: Update[], users: User[] = [], chats: Chat[] = []) {
    this.apiUpdatesManager.processUpdateMessage({
      _: 'updates',
      updates,
      users,
      chats,
      date: tsNow(true),
      seq: 0
    });
  }

  /** A local id of this frontend's sends: each one is used once, and it is the id of the message until it is stored */
  private nextLocalId(lastMessageId: number) {
    return lastMessageId + LOCAL_ID_STEP * (++this.localIdCounter % (1 / LOCAL_ID_STEP));
  }

  private onMessageSent(localId: number, message: SignalMessage) {
    const pending = this.pendingSends.get(localId);
    const built = this.buildMessage(message);
    const forwardRandomId = this.pendingForwardCopies.get(localId);
    if(!pending && forwardRandomId !== undefined) {
      this.pendingForwardCopies.delete(localId);
      this.pushUpdates([
        {_: 'updateMessageID', id: message.id, random_id: forwardRandomId},
        {_: 'updateNewMessage', message: built, pts: 0, pts_count: 0}
      ]);
      return;
    }

    if(!pending) {
      // * sent from Web A's other tab before this one took over, or a resend: a message like any other
      this.pushUpdates([{_: 'updateNewMessage', message: built, pts: 0, pts_count: 0}]);
      return;
    }

    this.pendingSends.delete(localId);
    pending.deferred.resolve({
      _: 'updates',
      updates: [
        {_: 'updateMessageID', id: message.id, random_id: pending.randomId},
        {_: 'updateNewMessage', message: built, pts: 0, pts_count: 0}
      ],
      users: [],
      chats: [],
      date: tsNow(true),
      seq: 0
    });
  }

  /** The Web K id of an input user, `inputUserSelf` being us */
  private getInputUserId(inputUser: InputUser): UserId | undefined {
    if(inputUser._ === 'inputUserSelf') return this.appPeersManager.peerId.toUserId();
    return inputUser._ === 'inputUser' ? +inputUser.user_id : undefined;
  }

  // * Telegram's entity names with an upper-case first letter are Web A's `ApiMessageEntityTypes`; a mention that Web K
  // * sends names its user with an input user, and it is Web A's `MessageEntityMentionName`
  private buildSignalEntity(entity: MethodDeclMap['messages.sendMessage']['req']['entities'][number]) {
    const isInputMention = entity._ === 'inputMessageEntityMentionName';
    const name = isInputMention ? 'messageEntityMentionName' : entity._;
    const userId = isInputMention ? this.getInputUserId(entity.user_id) : (entity as {user_id?: UserId}).user_id;
    return {
      type: name.charAt(0).toUpperCase() + name.slice(1),
      offset: entity.offset,
      length: entity.length,
      url: (entity as {url?: string}).url,
      userId: userId ? toSignalPeerId(userId) : undefined,
      language: (entity as {language?: string}).language
    };
  }

  private onMessageSendFailed(localId: number) {
    this.pendingForwardCopies.delete(localId);
    const pending = this.pendingSends.get(localId);
    if(!pending) {
      return;
    }

    this.pendingSends.delete(localId);
    pending.deferred.reject(makeError('SIGNAL_SEND_FAILED' as ErrorType));
  }

  private onReadState(chatId: string, readState: {unreadCount?: number, lastReadInboxMessageId?: number, lastReadOutboxMessageId?: number}) {
    const peer = buildPeer(chatId);
    const updates: Update[] = [];
    if(readState.lastReadOutboxMessageId) {
      updates.push({_: 'updateReadHistoryOutbox', peer, max_id: readState.lastReadOutboxMessageId, pts: 0, pts_count: 0});
    }

    if(readState.lastReadInboxMessageId !== undefined || readState.unreadCount !== undefined) {
      updates.push({
        _: 'updateReadHistoryInbox',
        peer,
        max_id: readState.lastReadInboxMessageId || 0,
        still_unread_count: readState.unreadCount || 0,
        pts: 0,
        pts_count: 0
      });
    }

    if(updates.length) {
      this.pushUpdates(updates);
    }
  }

  private onTyping(chatId: string, userId: string, isTyping: boolean) {
    const action = {_: isTyping ? 'sendMessageTypingAction' : 'sendMessageCancelAction'} as const;
    if(isGroupPeerId(chatId)) {
      this.pushUpdates([{
        _: 'updateChatUserTyping',
        chat_id: -toPeerId(chatId),
        from_id: buildPeer(userId),
        action
      }]);
    } else {
      this.pushUpdates([{_: 'updateUserTyping', user_id: toPeerId(userId), action}]);
    }
  }
}

function getProvider() {
  return provider ??= import('@signal-app/provider');
}


function getPeerIdOfPeer(peer: Peer) {
  switch(peer._) {
    case 'peerUser':
      return +peer.user_id;
    case 'peerChat':
      return -peer.chat_id;
    default:
      return undefined;
  }
}

