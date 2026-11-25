/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import type {Chat, Dialog as MTDialog, DialogPeer, Message, MessagesPeerDialogs, Update, MessagesMessages, MessagesSavedDialogs} from '@layer';
import type {AppMessagesManager, Dialog, MyMessage, SavedDialog} from '@appManagers/appMessagesManager';
import type {AccountDatabase} from '@config/databases/state';
import tsNow from '@helpers/tsNow';
import noop from '@helpers/noop';
import SearchIndex from '@lib/searchIndex';
import {SliceEnd} from '@helpers/slicedArray';
import {MyDialogFilter} from '@lib/storages/filters';
import {CHANNEL_CUTOFF_RETRY_LIMIT, FOLDER_ID_ALL, FOLDER_ID_ARCHIVE, NULL_PEER_ID, REAL_FOLDERS, REAL_FOLDER_ID, TEST_NO_SAVED} from '@appManagers/constants';
import {MaybePromise, Modify, NoneToVoidFunction} from '@types';
import ctx from '@environment/ctx';
import AppStorage from '@lib/storage';
import forEachReverse from '@helpers/array/forEachReverse';
import indexOfAndSplice from '@helpers/array/indexOfAndSplice';
import insertInDescendSortedArray from '@helpers/array/insertInDescendSortedArray';
import safeReplaceObject from '@helpers/object/safeReplaceObject';
import getServerMessageId from '@appManagers/utils/messageId/getServerMessageId';
import {AppManager} from '@appManagers/manager';
import getDialogIndexKey from '@appManagers/utils/dialogs/getDialogIndexKey';
import isObject from '@helpers/object/isObject';
import getDialogIndex from '@appManagers/utils/dialogs/getDialogIndex';
import getPeerIdsFromMessage from '@appManagers/utils/messages/getPeerIdsFromMessage';
import getMessageThreadId from '@appManagers/utils/messages/getMessageThreadId';
import {AppStoragesManager} from '@appManagers/appStoragesManager';
import defineNotNumerableProperties from '@helpers/object/defineNotNumerableProperties';
import setDialogIndex from '@appManagers/utils/dialogs/setDialogIndex';
import deferredPromise, {CancellablePromise} from '@helpers/cancellablePromise';
import {BroadcastEvents} from '@lib/rootScope';
import assumeType from '@helpers/assumeType';
import makeError from '@helpers/makeError';
import getPeerId from '@appManagers/utils/peers/getPeerId';
import {isDialog, isSavedDialog} from '@appManagers/utils/dialogs/isDialog';
import getDialogKey from '@appManagers/utils/dialogs/getDialogKey';
import getDialogThreadId from '@appManagers/utils/dialogs/getDialogThreadId';
import type {DialogsPaginationOffsets} from '@appManagers/utils/dialogs/getDialogsPaginationOffsets';

export enum FilterType {
  Folder,
  Saved
}

export type FolderDialog = {
  dialog: Dialog,
  index: number
};

export type Folder = {
  dialogs: AnyDialog[],
  id: number,
  count: number,
  unreadMessagesCount: number,
  unreadPeerIds: Set<PeerId>,
  unreadUnmutedPeerIds: Set<PeerId>,
  unreadMentionsPeerIds: Set<PeerId>,
  dispatchUnreadTimeout?: number
};

export type AnyDialog = Dialog | SavedDialog;

export type DialogUnreadState = {
  count: number,
  messages: number,
  markOnly: boolean,
  unmuted: boolean
};

export const GLOBAL_FOLDER_ID: REAL_FOLDER_ID = undefined;

// let spentTime = 0;
export default class DialogsStorage extends AppManager {
  private storage: AppStoragesManager['storages']['dialogs'];

  private dialogs: {[peerId: PeerId]: Dialog};
  private savedDialogs: {[peerId: PeerId]: SavedDialog};

  private folders: {[folderId: number]: Folder};

  private allDialogsLoaded: {[folder_id: number]: boolean};
  private dialogsOffsetDate: {[folder_id: number]: number};
  // * the `messages.getDialogs` pagination frontier of a folder (or of GLOBAL_FOLDER_ID), taken from
  // * the LAST dialog of the previous server page in response order (see `getDialogsPaginationOffsets`).
  // * Unlike `dialogsOffsetDate` (the oldest date seen), one dialog the server returns out of its date
  // * order can't make the next page skip everything between the two dates
  private dialogsPaginationOffsets: {[folder_id: number]: DialogsPaginationOffsets};
  private pinnedOrders: {[folder_id: number]: PeerId[]};
  private dialogsNum: number;
  // * the index a dialog took among those of its date, and the top message it took it for
  private dateIndexes: WeakMap<AnyDialog, {index: number, topMessage: number}>;

  private dialogsIndex: SearchIndex<PeerId>;

  private cachedResults: {
    query: string,
    count: number,
    dialogs: Dialog[],
    folderId: number
  };

  private savedDialogsPromises: Map<PeerId, Promise<SavedDialog>>;

  constructor() {
    super();
    this.name = 'DIALOGS';
  }

  protected after() {
    this.clear(true);

    const onFilterUpdate = (filter: MyDialogFilter) => {
      const dialogs = this.getCachedDialogs(false);
      for(let i = 0; i < dialogs.length; ++i) {
        this.processDialogForFilter(dialogs[i], filter);
      }
    };

    this.rootScope.addEventListener('filter_order', () => {
      const dialogs = this.getCachedDialogs(false);
      // const indexKeys: ReturnType<DialogsStorage['getDialogIndexKey']>[] = [];
      for(const filterId in this.folders) {
        if(!this.isVirtualFilter(+filterId)) {
          delete this.folders[filterId];
        }

        // indexKeys.push(this.getDialogIndexKey(+filterId));
      }

      for(let i = 0; i < dialogs.length; ++i) {
        const dialog = dialogs[i];
        // for(const indexKey of indexKeys) {
        //   delete dialog[indexKey];
        // }

        this.processDialogForFilters(dialog);
      }
    });

    this.rootScope.addEventListener('filter_update', onFilterUpdate);
    this.rootScope.addEventListener('filter_new', onFilterUpdate);

    this.rootScope.addEventListener('filter_delete', (filter) => {
      const dialogs = this.getCachedDialogs(false);

      const indexKey = this.getDialogIndexKeyByFilterId(filter.id);
      for(let i = 0; i < dialogs.length; ++i) {
        const dialog = dialogs[i];
        delete dialog[indexKey];
      }

      delete this.folders[filter.id];
    });

    this.rootScope.addEventListener('dialog_notify_settings', (dialog) => {
      this.processChangedUnreadOrUnmuted(dialog.peerId);
    });

    this.rootScope.addEventListener('chat_update', (chatId) => {
      const peerId = chatId.toPeerId(true);
      const dialog = this.getDialogOnly(peerId);
      if(dialog && !this.canSaveDialog(peerId, dialog)) {
        this.dropDialogOnDeletion(peerId);
      }
    });

    this.rootScope.addEventListener('user_auth', () => {
      this.rootScope.addEventListener('premium_toggle', () => {
        [FOLDER_ID_ALL, FOLDER_ID_ARCHIVE].forEach((folderId) => {
          this.apiUpdatesManager.processLocalUpdate({_: 'updatePinnedDialogs', folder_id: folderId});
        });
      });
    });

    this.apiUpdatesManager.addMultipleEventsListeners({
      updateFolderPeers: this.onUpdateFolderPeers,

      updateDialogPinned: this.onUpdateDialogPinned,
      updateSavedDialogPinned: this.onUpdateDialogPinned,

      updatePinnedDialogs: this.onUpdatePinnedDialogs,
      updatePinnedSavedDialogs: this.onUpdatePinnedDialogs
    });

    return Promise.all([
      this.appStateManager.getState(),
      this.appStoragesManager.loadStorage('dialogs')
    ]).then(([state, {results: dialogs, storage}]) => {
      this.storage = storage;
      this.dialogs = this.storage.getCache();

      // * repair orders persisted before saveDialog started cleaning the folder a pinned dialog
      // * left: a dialog can only be pinned in the folder it lives in, and a foreign entry stays
      // * forever, silently eating the pin limit
      const cachedFolderIds: Map<PeerId, number> = new Map();
      for(const dialog of dialogs) {
        if(dialog) {
          cachedFolderIds.set(dialog.peerId, dialog.folder_id ?? FOLDER_ID_ALL);
        }
      }

      let hasForeignPinned = false;
      for(const folderId of REAL_FOLDERS) {
        const order = state.pinnedOrders[folderId];
        if(!order) {
          continue;
        }

        const filtered = order.filter((peerId) => {
          const cachedFolderId = cachedFolderIds.get(peerId);
          return cachedFolderId === undefined || cachedFolderId === folderId;
        });

        hasForeignPinned ||= filtered.length !== order.length;

        const _order = this.getPinnedOrders(folderId);
        _order.splice(0, _order.length, ...filtered);
      }

      if(hasForeignPinned) {
        this.savePinnedOrders();
      }

      if(dialogs.length) {
        AppStorage.freezeSaving<AccountDatabase>(this.setDialogsFromState.bind(this, dialogs), ['chats', 'dialogs', 'messages', 'users']);
      }

      this.allDialogsLoaded = state.allDialogsLoaded || {};
      this.dialogsPaginationOffsets = state.dialogsPaginationOffsets || {};
      // * the same point where the restored dialogs get their peers: before anything prunes the unneeded ones
      for(const key in this.dialogsPaginationOffsets) {
        this.requestPaginationOffsetsPeer(key, this.dialogsPaginationOffsets[key]);
      }

      if(dialogs.length) {
        this.appDraftsManager.addMissedDialogs();
      }
    });
  }

  public indexMyDialog() {
    const peerId = this.appUsersManager.getSelf().id.toPeerId(false);
    const dialog = this.getDialogOnly(peerId);
    if(dialog) {
      const peerText = this.appPeersManager.getPeerSearchText(peerId);
      this.dialogsIndex.indexObject(peerId, peerText);
    }
  }

  private setDialogsFromState(dialogs: Dialog[]) {
    for(let i = 0, length = dialogs.length; i < length; ++i) {
      const dialog = dialogs[i];
      if(!dialog) {
        continue;
      }

      // if(dialog.peerId !== SERVICE_PEER_ID) {
      dialog.top_message = getServerMessageId(dialog.top_message); // * fix outgoing message to avoid copying dialog
      // }

      if(dialog.topMessage) {
        this.appMessagesManager.saveMessages([dialog.topMessage]);
      }

      for(let i = 0; i <= 21; ++i) {
        const indexKey: ReturnType<typeof getDialogIndexKey> = `index_${i}` as any;
        delete dialog[indexKey];
      }
      // delete dialog.indexes;

      this.saveDialog({
        dialog,
        ignoreOffsetDate: true
      });

      // ! WARNING, убрать это когда нужно будет делать чтобы pending сообщения сохранялись
      const message = this.appMessagesManager.getMessageByPeer(dialog.peerId, dialog.top_message);
      if(!message) {
        this.appMessagesManager.reloadConversation(dialog.peerId);
      }
    }
  }

  public isDialogsLoaded(folderId: number) {
    return !!this.allDialogsLoaded[folderId];
  }

  public setDialogsLoaded(folderId: number, loaded: boolean) {
    const isVirtualFilter = this.isVirtualFilter(folderId);

    if(folderId === GLOBAL_FOLDER_ID && loaded) {
      this.allDialogsLoaded[FOLDER_ID_ALL] = loaded;
      this.allDialogsLoaded[FOLDER_ID_ARCHIVE] = loaded;
    } else {
      if(isVirtualFilter) {
        defineNotNumerableProperties(this.allDialogsLoaded, [folderId]);
      }

      this.allDialogsLoaded[folderId] = loaded;
    }

    if(isVirtualFilter) {
      return;
    }

    if(Array.from(REAL_FOLDERS).every((folderId) => this.allDialogsLoaded[folderId])) {
      this.allDialogsLoaded[GLOBAL_FOLDER_ID] = true;
    }

    this.saveAllDialogsLoaded();
  }

  private saveAllDialogsLoaded() {
    this.appStateManager.pushToState('allDialogsLoaded', this.allDialogsLoaded);
  }

  public clear = (init = false) => {
    if(!init) {
      this.storage.clear();

      this.allDialogsLoaded = {};
      this.saveAllDialogsLoaded();

      this.resetDialogsPaginationOffsets();
      this.saveDialogsPaginationOffsets();

      // * clear not numerable properties
      this.pinnedOrders = Object.assign({}, this.pinnedOrders);
      for(const folderId of REAL_FOLDERS) {
        this.resetPinnedOrder(folderId);
      }
      this.savePinnedOrders();
    } else {
      this.allDialogsLoaded = {};
      this.resetDialogsPaginationOffsets();
      this.pinnedOrders = {};
      for(const folderId of REAL_FOLDERS) {
        this.pinnedOrders[folderId] = [];
      }
    }

    this.savedDialogsPromises = new Map();
    this.folders = {};
    this.dialogsOffsetDate = {};
    this.dialogsNum = 0;
    this.dateIndexes = new WeakMap();
    this.dialogsIndex = this.createSearchIndex();
    this.cachedResults = {
      query: '',
      count: 0,
      dialogs: [],
      folderId: 0
    };
    this.savedDialogs = {};
  };

  private createSearchIndex<T>() {
    return new SearchIndex<T>({
      clearBadChars: true,
      ignoreCase: true,
      latinize: true,
      includeTag: true
    });
  }

  public handleDialogUnpinning(dialog: AnyDialog, folderId: number) {
    delete dialog.pFlags.pinned;
    indexOfAndSplice(this.getPinnedOrders(folderId), getDialogKey(dialog));
    this.savePinnedOrders();
  }

  public savePinnedOrders() {
    this.appStateManager.pushToState('pinnedOrders', this.pinnedOrders);
  }

  /** A pin given (the topmost) or taken back in a folder's pin order by its key, and saved */
  public togglePinInOrder(folderId: number, key: PeerId, pinned: boolean) {
    const order = this.getPinnedOrders(folderId);
    if(!order) {
      return;
    }

    indexOfAndSplice(order, key);
    if(pinned) {
      order.unshift(key);
    }

    this.savePinnedOrders();
  }

  public resetPinnedOrder(folderId: number) {
    this.getPinnedOrders(folderId).length = 0;
  }

  /**
   * The pins of one list in visual order, topmost first, whichever kind of list it is - a real
   * folder, a chat folder or the Saved Messages sublists. A chat folder carries its own
   * pins; the real folders' local filters share the very array kept here.
   */
  public getPinnedOrderForFilter(filterId: number) {
    const filter = this.filtersStorage.getFilter(filterId);
    return ((filter ? filter.pinnedPeerIds : this.getPinnedOrders(filterId)) || []).slice();
  }

  public getPinnedOrders(folderId: number) {
    let orders = this.pinnedOrders[folderId];
    if(!orders && this.isVirtualFilter(folderId)) {
      defineNotNumerableProperties(this.pinnedOrders, [folderId]);
      orders = this.pinnedOrders[folderId] = [];
    }

    return orders;
  }

  /** How many pins the user can see in the folder, which is what the pin limit is about */
  public getVisiblePinnedCount(folderId: number) {
    return this.getPinnedOrders(folderId).length;
  }

  public isDialogPinned(peerId: PeerId, folderId: number) {
    const filter = this.filtersStorage.getFilter(folderId);
    let isPinned: boolean;
    if(filter) {
      isPinned = filter.pinnedPeerIds.indexOf(peerId) !== -1;
    } else {
      isPinned = !!this.getDialogOnly(peerId).pFlags.pinned;
    }

    return isPinned;
  }

  /**
   * The offsets of the next `messages.getDialogs` page of a folder, if a page of it was received.
   * Ignored while no dialog of the folder is loaded (e.g. the dialogs storage was reset while the
   * state kept the offsets): the list must then start from the top again. For GLOBAL_FOLDER_ID a loaded
   * dialog of any real folder counts, since only those are restored from the state after a reload.
   */
  public getDialogsPaginationOffsets(folderId: number): DialogsPaginationOffsets {
    const hasLoadedDialogs = folderId === GLOBAL_FOLDER_ID ?
      !!this.dialogsOffsetDate[GLOBAL_FOLDER_ID] || Array.from(REAL_FOLDERS).some((realFolderId) => !!this.dialogsOffsetDate[realFolderId]) :
      !!this.dialogsOffsetDate[folderId];
    if(!hasLoadedDialogs) {
      return;
    }

    return this.dialogsPaginationOffsets?.[folderId];
  }

  public setDialogsPaginationOffsets(folderId: number, offsets: DialogsPaginationOffsets) {
    (this.dialogsPaginationOffsets ??= {})[folderId] = offsets;
    this.requestPaginationOffsetsPeer(String(folderId), offsets);
    this.saveDialogsPaginationOffsets();
  }

  // * the offsets' peer is sent as `offset_peer` after a reload, so it has to stay in the storage until the offsets go
  private requestPaginationOffsetsPeer(folderKey: string, offsets?: DialogsPaginationOffsets) {
    // * the object key of GLOBAL_FOLDER_ID (undefined) is 'undefined'
    const key = `paginationOffsets_${folderKey === String(GLOBAL_FOLDER_ID) ? 'all' : folderKey}` as const;
    this.peersStorage.requestPeersForKey(offsets?.peerId ? [offsets.peerId] : [], key);
  }

  private resetDialogsPaginationOffsets() {
    for(const key in this.dialogsPaginationOffsets) {
      this.requestPaginationOffsetsPeer(key, undefined);
    }

    this.dialogsPaginationOffsets = {};
  }

  private saveDialogsPaginationOffsets() {
    this.appStateManager.pushToState('dialogsPaginationOffsets', this.dialogsPaginationOffsets);
  }

  public getOffsetDate(folderId: number): number {
    const offsetDate = this.dialogsOffsetDate[folderId] || 0;
    if(folderId === GLOBAL_FOLDER_ID && !offsetDate) { // make request not from beginning if we have loaded some dialogs
      return Math.min(...Array.from(REAL_FOLDERS).sort((a, b) => a - b));
    }

    return offsetDate;
  }

  private generateFolder(id: number) {
    const folder: Folder = {
      dialogs: [],
      id,
      count: null,
      unreadMessagesCount: 0,
      unreadPeerIds: new Set(),
      unreadUnmutedPeerIds: new Set(),
      unreadMentionsPeerIds: new Set()
    };

    defineNotNumerableProperties(folder, ['dispatchUnreadTimeout']);

    return folder;
  }

  public getFolder(id: number) {
    return this.folders[id] ??= this.generateFolder(id);
  }

  public isVirtualFilter(filterId: number) {
    return this.getFilterType(filterId) !== FilterType.Folder;
  }

  public getFilterType(filterId: number) {
    if(filterId === this.appPeersManager.peerId) return FilterType.Saved;
    else return FilterType.Folder;
  }

  public getFolderDialogs(id: number, skipMigrated = true): Folder['dialogs'] {
    if(id === GLOBAL_FOLDER_ID) { // * it won't be sorted
      return this.getCachedDialogs(skipMigrated);
    }

    const folder = this.getFolder(id);
    const filterType = this.getFilterType(id);
    if(filterType === FilterType.Saved) {
      return folder.dialogs;
    }

    return skipMigrated ? folder.dialogs.filter((dialog) => (dialog as Dialog).migratedTo === undefined) : folder.dialogs;
  }

  /**
   * The chat next to `currentPeerId` in the folder - among `shownPeerIds` only when the list
   * shows only some of its chats (unread ones), the current chat counted wherever it is
   */
  public getNextDialog(currentPeerId: PeerId, next: boolean, filterId: number, shownPeerIds?: PeerId[]) {
    let folder = this.getFolderDialogs(filterId, true);
    if(shownPeerIds) {
      const shown = new Set(shownPeerIds);
      folder = folder.filter(({peerId}) => peerId === currentPeerId || shown.has(peerId));
    }

    let dialog: Folder['dialogs'][0];
    if(!currentPeerId) {
      if(next) {
        dialog = folder[0];
      }
    } else {
      const idx = folder.findIndex((dialog) => dialog.peerId === currentPeerId);
      if(idx !== -1) {
        const nextIndex = next ? idx + 1 : idx - 1;
        dialog = folder[nextIndex];
      }
    }

    return dialog;
  }

  public getDialogIndexKeyByFilterId(filterId: number) {
    if(this.isVirtualFilter(filterId)) return getDialogIndexKey();
    if(REAL_FOLDERS.has(filterId)) return getDialogIndexKey(filterId as REAL_FOLDER_ID);
    const filter = this.filtersStorage.getFilter(filterId);
    return getDialogIndexKey(filter.localId);
  }

  private isDialogUnmuted(dialog: Dialog) {
    return !this.appNotificationsManager.isPeerLocalMuted({
      peerId: dialog.peerId,
      respectType: true
    });
  }

  public getFolderUnreadCount(filterId: number) {
    const folder = this.getFolder(filterId);
    return {
      unreadUnmutedCount: folder.unreadUnmutedPeerIds.size,
      unreadCount: folder.unreadPeerIds.size,
      unreadMentionsCount: folder.unreadMentionsPeerIds.size
    };
  }

  public getCachedDialogs(skipMigrated?: boolean) {
    const arrays = Array.from(REAL_FOLDERS).map((folderId) => this.getFolderDialogs(folderId, skipMigrated));
    return [].concat(...arrays) as Dialog[];
  }

  private setDialogIndexInFilter(
    dialog: AnyDialog,
    indexKey: ReturnType<typeof getDialogIndexKey>,
    filter?: MyDialogFilter
  ) {
    // if(this.isTopic(dialog)) {
    //   return dialog['index_0'];
    // }

    let index: number;

    const isVirtual = this.isVirtualFilter(this.getDialogFilterId(dialog));
    const isRealFolder = isVirtual || REAL_FOLDERS.has(filter.id);
    /* if(isRealFolder) {
      // index = getDialogIndex(dialog, indexKey);
      index = this.generateIndexForDialog(dialog, true);
    } else  */if(this.filtersStorage.testDialogForFilter(dialog, filter)) {
      const pinnedIds = isVirtual ?
        this.getPinnedOrdersByDialog(dialog) :
        filter.pinnedPeerIds;

      const pinnedKey = getDialogKey(dialog);
      const pinnedIndex = pinnedIds.indexOf(pinnedKey);

      if(pinnedIndex !== -1) {
        index = this.generateDialogIndex(this.generateDialogPinnedDateByIndex(pinnedIds.length - 1 - pinnedIndex), true);
      } else if(dialog.pFlags?.pinned || isRealFolder) {
        index = this.generateIndexForDialog(dialog, true, undefined, !isRealFolder);
      } else {
        index = getDialogIndex(dialog) ?? this.generateIndexForDialog(dialog, true);
      }
    }

    // if(!dialog.hasOwnProperty(indexKey)) {
    //   defineNotNumerableProperties(dialog, [indexKey]);
    // }

    return setDialogIndex(dialog, indexKey, index);
  }

  public getDialog(peerId: PeerId, folderId?: number, savedId?: number, skipMigrated = true): [Folder['dialogs'][0], number] | [] {
    const folders: Folder['dialogs'][] = [];

    if(savedId) {
      folderId = peerId;
      // skipMigrated = false;
    }

    if(folderId === undefined) {
      folders.push(...Array.from(REAL_FOLDERS).map((folderId) => this.getFolder(folderId).dialogs));
    } else {
      folders.push(this.getFolderDialogs(folderId, false));
    }

    let verify: (d: Folder['dialogs'][0]) => boolean;
    if(savedId) {
      verify = (dialog) => (dialog as SavedDialog).savedPeerId === savedId;
    } else {
      verify = (dialog) => dialog.peerId === peerId;
    }

    for(const folder of folders) {
      let i = 0, skipped = 0;
      for(const length = folder.length; i < length; ++i) {
        const dialog = folder[i];
        if(verify(dialog)) {
          return [dialog, i - skipped];
        } else if(skipMigrated && (dialog as Dialog).migratedTo !== undefined) {
          ++skipped;
        }
      }
    }

    return [];
  }

  public getDialogOnly(peerId: PeerId) {
    return this.dialogs[peerId];
  }

  public getAnyDialog(peerId: PeerId, savedId?: number) {
    if(savedId) {
      return peerId.isUser() ? this.savedDialogs[savedId] : undefined;
    }

    return this.dialogs[peerId];
  }

  public getDialogIndex(
    peerId: PeerId | Parameters<typeof getDialogIndex>[0],
    indexKey: ReturnType<typeof getDialogIndexKey>,
    savedId?: number
  ) {
    const dialog = isObject(peerId) ? peerId : this.getAnyDialog(peerId, savedId);
    return getDialogIndex(dialog, indexKey);
  }

  /*
  var date = Date.now() / 1000 | 0;
  var m = date * 0x10000;

  var k = (date + 1) * 0x10000;
  k - m;
  65536
  */
  public generateDialogIndex(date?: number, isPinned?: boolean) {
    date ??= this.timeManager.getServerTime();
    return (date * 0x10000) + (isPinned ? 0 : (++this.dialogsNum & 0xFFFF));
  }

  // public makeFilterForTopics(id: number): MyDialogFilter {
  //   return {
  //     _: 'dialogFilter',
  //     id,

  //   };
  // }

  public getDialogFilterId(dialog: AnyDialog) {
    let filterId: number;
    if(isSavedDialog(dialog)) {
      filterId = dialog.peerId;
    } else {
      filterId = dialog.folder_id;
    }

    return filterId;
  }

  public getPinnedOrdersByDialog(dialog: AnyDialog) {
    return this.getPinnedOrders(this.getDialogFilterId(dialog));
  }

  public processDialogForFilters(dialog: AnyDialog, noIndex?: boolean) {
    // let perf = performance.now();
    if(!isDialog(dialog)) {
      this.processDialogForFilter(dialog, undefined, noIndex);
      return;
    }

    const filters = this.filtersStorage.getFilters();
    for(const id in filters) {
      const filter = filters[id];
      this.processDialogForFilter(dialog, filter, noIndex);
    }
    // spentTime += (performance.now() - perf);
    // console.log('generate index time:', spentTime);
  }

  public processDialogForFilter(
    dialog: AnyDialog,
    filter?: MyDialogFilter,
    noIndex?: boolean
  ) {
    const folderId = filter?.id ?? this.getDialogFilterId(dialog);

    const indexKey = this.getDialogIndexKeyByFilterId(folderId);
    const folder = this.getFolder(folderId);
    const dialogs = folder.dialogs;

    const m: {[key in AnyDialog['_']]: (dialog: any) => boolean} = {
      dialog: (dialog1: Dialog) => dialog1.peerId === (dialog as Dialog).peerId,
      savedDialog: (dialog1: SavedDialog) => dialog1.savedPeerId === (dialog as SavedDialog).savedPeerId
    };

    const cmp = m[dialog._];
    const wasIndex = dialogs.findIndex(cmp);
    const wasDialog = dialogs[wasIndex];
    const wasDialogIndex = this.getDialogIndex(wasDialog, indexKey);

    // if(noIndex && !this.isVirtualFilter(folderId) && folderId > FOLDER_ID_ARCHIVE) {
    //   noIndex = undefined;
    // }

    const newDialogIndex = noIndex ? undefined : this.setDialogIndexInFilter(dialog, indexKey, filter);

    if(wasDialogIndex === newDialogIndex) {
      return false;
    }

    if(!!wasDialogIndex !== !!newDialogIndex) {
      this.prepareFolderUnreadCountModifyingByDialog(folderId, dialog, !!newDialogIndex);
    }

    // * a virtual folder's count is the server's total (set from paged responses) — it already
    // * includes entries that were never loaded locally, so local membership changes must not touch
    // * it: every entry arriving from a page would be counted twice, inflating the list's virtual
    // * size. Once the folder is fully loaded, consumers use its length instead
    const adjustCount = folder.count !== null && !this.isVirtualFilter(folderId);

    if(wasIndex !== -1) {
      dialogs.splice(wasIndex, 1);
      // * one that only moves within the folder (put back below, by the same test of its index) is still counted
      if(adjustCount && !newDialogIndex) {
        --folder.count;
      }
    }

    if(newDialogIndex) {
      insertInDescendSortedArray(dialogs, dialog, (dialog) => this.getDialogIndex(dialog, indexKey), -1);

      if(wasIndex === -1 && adjustCount) {
        ++folder.count;
      }
    }

    return true;
  }

  public prepareDialogUnreadCountModifying(dialog: AnyDialog, toggle?: boolean) {
    if(isSavedDialog(dialog)) {
      return () => {};
    }

    const callbacks: NoneToVoidFunction[] = [];
    callbacks.push(this.prepareFolderUnreadCountModifyingByDialog(dialog.folder_id, dialog, toggle));

    const filters = this.filtersStorage.getFilters();
    for(const id in filters) {
      const filter = filters[id];
      if(this.filtersStorage.testDialogForFilter(dialog, filter)) {
        callbacks.push(this.prepareFolderUnreadCountModifyingByDialog(filter.id, dialog, toggle));
      }
    }

    return () => !toggle && callbacks.forEach((callback) => callback());
  }

  public prepareFolderUnreadCountModifyingByDialog(folderId: number, dialog: AnyDialog, toggle?: boolean) {
    if(isSavedDialog(dialog)) {
      if(toggle !== undefined) {
        return;
      }

      return () => {};
    }

    const wasUnreadCount = this.appMessagesManager.getDialogUnreadCount(dialog);
    const wasUnmuted = this.isDialogUnmuted(dialog);
    const wasUnreadMentionsCount = wasUnreadCount ? dialog.unread_mentions_count : 0;

    if(toggle !== undefined) {
      const addMessagesCount = toggle ? wasUnreadCount : -wasUnreadCount;
      // this.modifyFolderUnreadCount(folderId, addMessagesCount, !!wasUnreadCount, wasUnreadCount && wasUnmuted, dialog);
      this.modifyFolderUnreadCount(
        folderId,
        addMessagesCount,
        !!(toggle && wasUnreadCount),
        !!(toggle && wasUnreadCount && wasUnmuted),
        !!(toggle && wasUnreadMentionsCount),
        dialog
      );
      return;
    }

    return () => {
      const newUnreadCount = this.appMessagesManager.getDialogUnreadCount(dialog);
      const newUnmuted = this.isDialogUnmuted(dialog);
      const newUnreadMentionsCount = newUnreadCount ? dialog.unread_mentions_count : 0;

      const addMessagesCount = newUnreadCount - wasUnreadCount;
      this.modifyFolderUnreadCount(
        folderId,
        addMessagesCount,
        !!newUnreadCount,
        !!(newUnreadCount && newUnmuted),
        !!newUnreadMentionsCount,
        dialog
      );
    };
  }

  public modifyFolderUnreadCount(
    folderId: number,
    addMessagesCount: number,
    toggleDialog: boolean,
    toggleUnmuted: boolean,
    toggleMentions: boolean,
    dialog: Dialog
  ) {
    const folder = this.getFolder(folderId);
    if(addMessagesCount) {
      folder.unreadMessagesCount = Math.max(0, folder.unreadMessagesCount + addMessagesCount);
    }

    const key = getDialogKey(dialog);
    if(toggleDialog) {
      folder.unreadPeerIds.add(key);
    } else {
      folder.unreadPeerIds.delete(key);
    }

    if(toggleUnmuted) {
      folder.unreadUnmutedPeerIds.add(key);
    } else {
      folder.unreadUnmutedPeerIds.delete(key);
    }

    if(toggleMentions) {
      folder.unreadMentionsPeerIds.add(key);
    } else {
      folder.unreadMentionsPeerIds.delete(key);
    }

    folder.dispatchUnreadTimeout ??= ctx.setTimeout(() => {
      folder.dispatchUnreadTimeout = undefined;
      const _folder = {...folder};
      delete _folder.dialogs;
      this.rootScope.dispatchEvent('folder_unread', _folder);
    }, 0);
  }

  public processChangedUnreadOrUnmuted(peerId: PeerId) {
    const dialog = this.getDialogOnly(peerId);
    if(!dialog) {
      return;
    }

    this.processDialogForFilters(dialog);
    this.prepareDialogUnreadCountModifying(dialog)(); // * because counter won't be changed if only changed muted status
    this.rootScope.dispatchEvent('dialog_unread', {
      peerId,
      dialog
    });
  }

  public generateIndexForDialog(
    dialog: AnyDialog,
    justReturn?: boolean,
    message?: MyMessage,
    noPinnedOrderUpdate?: boolean
  ) {
    if(!justReturn/*  && !isTopic */) {
      return;
    }

    const _isDialog = isDialog(dialog);
    let topDate = 0, isPinned: boolean;
    if(dialog.pFlags.pinned && !noPinnedOrderUpdate) {
      topDate = this.generateDialogPinnedDate(dialog);
      isPinned = true;
    } else {
      topDate = this.getDialogActivityDate(dialog, message);
    }

    topDate ||= tsNow(true);

    // * dialogs of one date stand in the order they took their indexes in, as in tdesktop: only a new date or
    // * top message takes a new one - a re-run for a read or a mute must not lift a dialog over its neighbours
    const was = !isPinned && this.dateIndexes.get(dialog);
    if(was && was.topMessage === dialog.top_message && Math.floor(was.index / 0x10000) === topDate) {
      return was.index;
    }

    const index = this.generateDialogIndex(topDate, isPinned);
    if(!isPinned) {
      this.dateIndexes.set(dialog, {index, topMessage: dialog.top_message});
    }

    if(justReturn) {
      return index;
    }

    const indexKey = getDialogIndexKey((dialog as Dialog).folder_id);
    setDialogIndex(dialog, indexKey, index);
  }

  public getDialogActivityDate(dialog: AnyDialog, message?: MyMessage) {
    const {peerId} = dialog;
    message ||= this.appMessagesManager.getMessageByPeer(peerId, dialog.top_message);

    let date = (message as Message.message | Message.messageService)?.date || 0;
    if(isDialog(dialog)) {
      const channelId = this.appPeersManager.isChannel(peerId) && peerId.toChatId();
      if(channelId) {
        const channel = this.appChatsManager.getChat(channelId) as Chat.channel;
        if(channel.date && channel.date > date) {
          date = channel.date;
        }
      }
    }

    if(
      isDialog(dialog) &&
      dialog.draft?._ === 'draftMessage' &&
      dialog.draft.date > date
    ) {
      date = dialog.draft.date;
    }

    return date;
  }

  public getDialogUnreadState(dialog: Dialog, isMuted: boolean): DialogUnreadState {
    const count = this.appMessagesManager.getDialogUnreadCount(dialog);
    if(!count) {
      return {
        count: 0,
        messages: 0,
        markOnly: false,
        unmuted: false
      };
    }

    return {
      count,
      messages: dialog.unread_count || 0,
      markOnly: !dialog.unread_count && !!dialog.pFlags.unread_mark,
      unmuted: !isMuted
    };
  }

  public generateDialogPinnedDateByIndex(pinnedIndex: number) {
    return 0x7fff0000 + (pinnedIndex & 0xFFFF); // 0xFFFF - потому что в папках может быть бесконечное число пиннедов
  }

  public generateDialogPinnedDate(dialog: AnyDialog) {
    const order = this.getPinnedOrdersByDialog(dialog);

    const dialogKey = getDialogKey(dialog);
    let pinnedIndex = order.indexOf(dialogKey);
    if(pinnedIndex === -1) {
      order.unshift(dialogKey);
      pinnedIndex = 0;

      if(isDialog(dialog)) {
        this.savePinnedOrders();
      }
    }

    return this.generateDialogPinnedDateByIndex(order.length - 1 - pinnedIndex);
  }

  /* public generateDialog(peerId: PeerId) {
    const dialog: Dialog = {
      _: 'dialog',
      pFlags: {},
      peer: this.appPeersManager.getOutputPeer(peerId),
      top_message: 0,
      read_inbox_max_id: 0,
      read_outbox_max_id: 0,
      unread_count: 0,
      unread_mentions_count: 0,
      notify_settings: {
        _: 'peerNotifySettings',
      },
    };

    return dialog;
  } */

  private getDialogMessageForState(dialog: AnyDialog) {
    const {peerId} = dialog;
    const threadId = isSavedDialog(dialog) ? dialog.savedPeerId : undefined;
    const historyStorage = this.appMessagesManager.getHistoryStorage(peerId, threadId);
    const messagesStorage = this.appMessagesManager.getHistoryMessagesStorage(peerId);
    const history = historyStorage.history.slice;
    let incomingMessage: MyMessage;
    for(let i = 0, length = history.length; i < length; ++i) {
      const mid = history[i];
      const message: MyMessage = this.appMessagesManager.getMessageFromStorage(messagesStorage, mid);
      if(message && !message.pFlags.is_outgoing/*  || peerId === SERVICE_PEER_ID */) {
        incomingMessage = message;
        break;
      }
    }

    return incomingMessage;
  }

  public setDialogToState(dialog: AnyDialog) {
    if(!isDialog(dialog)) {
      return;
    }

    const {peerId, pts} = dialog;
    const incomingMessage = this.getDialogMessageForState(dialog);
    if(incomingMessage) {
      const peerIds = getPeerIdsFromMessage(incomingMessage);
      this.peersStorage.requestPeersForKey(peerIds, `topMessage_${peerId}`);
    }

    dialog.topMessage = incomingMessage;

    // DO NOT TOUCH THESE LINES, SOME REAL MAGIC HERE.
    // * Read service chat when refreshing page with outgoing & getting new service outgoing message
    /* if(incomingMessage && dialog.read_inbox_max_id >= dialog.top_message) {
      dialog.unread_count = 0;
    }

    dialog.read_inbox_max_id = this.appMessagesIdsManager.clearMessageId(dialog.read_inbox_max_id);
    dialog.read_outbox_max_id = this.appMessagesIdsManager.clearMessageId(dialog.read_outbox_max_id); */
    // CAN TOUCH NOW

    if(peerId.isAnyChat() && pts) {
      const newPts = this.apiUpdatesManager.getChannelState(peerId.toChatId(), pts).pts;
      dialog.pts = newPts;
    }

    this.storage.set({
      [peerId]: dialog
    });

    this.peersStorage.requestPeer(peerId, 'dialog');

    /* for(let id in this.filtersStorage.filters) {
      const filter = this.filtersStorage.filters[id];

      if(this.filtersStorage.testDialogForFilter(dialog, filter)) {

      }
    } */
  }

  public pushDialog({dialog, offsetDate, ignoreOffsetDate, saveGlobalOffset}: {
    dialog: AnyDialog,
    offsetDate?: number,
    ignoreOffsetDate?: boolean,
    saveGlobalOffset?: boolean
  }) {
    const _isDialog = isDialog(dialog);
    const {peerId} = dialog;
    const key = getDialogKey(dialog);

    if(_isDialog) {
      this.dialogs[key] = dialog;
    } else if(isSavedDialog(dialog)) {
      this.savedDialogs[key] = dialog;
    }

    offsetDate ??= this.getDialogOffsetDate(dialog);

    // if(!isTopic) {
    this.processDialogForFilters(dialog);
    // }

    if(offsetDate && !dialog.pFlags.pinned) {
      if(_isDialog && saveGlobalOffset) {
        const savedGlobalOffsetDate = this.dialogsOffsetDate[GLOBAL_FOLDER_ID];
        if(!savedGlobalOffsetDate || offsetDate < savedGlobalOffsetDate) {
          this.setDialogOffsetDate(GLOBAL_FOLDER_ID, offsetDate);
        }
      }

      const folderId = this.getDialogFilterId(dialog);
      const savedOffsetDate = this.dialogsOffsetDate[folderId];
      if(!savedOffsetDate || offsetDate < savedOffsetDate) {
        // if(pos !== -1) {
        if(!ignoreOffsetDate && !this.isDialogsLoaded(folderId)) {
          this.dropDialog(peerId, getDialogThreadId(dialog), true);
          return;
        }

        this.setDialogOffsetDate(folderId, offsetDate);
      }
    }

    this.setDialogToState(dialog);

    // if(pos === -1) {
    // this.prepareFolderUnreadCountModifyingByDialog(folder_id, dialog, true);
    // }

    // const indexKey = getDialogIndexKey(folder_id);
    // /* const newPos =  */insertInDescendSortedArray(dialogs, dialog, (dialog) => getDialogIndex(dialog, indexKey), -1);
    /* if(pos !== -1 && pos !== newPos) {
      rootScope.dispatchEvent('dialog_order', {dialog, pos: newPos});
    } */
  }

  public dropDialogFromFolders(peerId: PeerId, savedId?: number, keepLocal?: boolean) {
    const foundDialog = this.getDialog(peerId, undefined, savedId, false);
    const [dialog] = foundDialog;
    if(dialog) {
      const filterId = this.getDialogFilterId(dialog);

      // const folder = this.getFolder(filterId);
      // folder.dialogs.splice(index, 1);
      const wasPinned = indexOfAndSplice(this.getPinnedOrders(filterId), getDialogKey(dialog)) !== undefined;

      this.processDialogForFilters(dialog, true);

      if(!keepLocal) {
        if(!isSavedDialog(dialog)) {
          this.dialogsIndex.indexObject(peerId, '');
        }
      }

      if(wasPinned) {
        this.savePinnedOrders();
      }
    }

    return foundDialog;
  }

  public dropDialog(peerId: PeerId, savedId?: number, keepLocal?: boolean) {
    const dialog = this.getAnyDialog(peerId, savedId);
    const foundDialog = this.dropDialogFromFolders(peerId, savedId, keepLocal);
    if(dialog) {
      if(!keepLocal) {
        if(isSavedDialog(dialog)) {
          delete this.savedDialogs[savedId];
        } else {
          delete this.dialogs[peerId];
        }
      }

      this.clearDialogFromState(dialog, keepLocal);
    }

    return foundDialog;
  }

  public clearDialogFromState(dialog: AnyDialog, keepLocal: boolean) {
    if(!isDialog(dialog)) {
      return;
    }

    const {peerId} = dialog;
    this.peersStorage.requestPeersForKey([], `topMessage_${peerId}`);
    this.peersStorage.releasePeer(peerId, 'dialog');
    this.storage.delete(peerId, keepLocal);
  }

  public dropDialogWithEvent(peerId: PeerId, savedId?: number) {
    const dropped = this.dropDialog(peerId, savedId);
    if(dropped.length) {
      this.rootScope.dispatchEvent('dialog_drop', dropped[0]);
    }

    return dropped;
  }

  /**
   * leaving chat, leaving channel, deleting private dialog
   */
  public dropDialogOnDeletion(peerId: PeerId, savedId?: number) {
    this.dropDialogWithEvent(peerId, savedId);

    // * drop 'you joined this channel' service message
    if(this.appPeersManager.isBroadcast(peerId)) {
      const historyStorage = this.appMessagesManager.getHistoryStorage(peerId);
      const mid = historyStorage?.channelJoinedMid;
      if(mid) {
        historyStorage.channelJoinedMid = undefined;
        this.appMessagesManager.processLocalDeleteMessages(peerId, [mid]);
      }
    }

    this.rootScope.dispatchEvent('peer_deleted', peerId);
  }

  public applyDialogs(
    result: MessagesPeerDialogs | ({_: 'messages.savedDialogs', dialogs: SavedDialog[]} & Parameters<AppMessagesManager['saveApiResult']>[0]),
    peerId?: PeerId,
    // * the notification settings clock's tick the result was asked for at (appNotificationsManager.getSettingsClock)
    settingsAskedAt?: number,
    // * the drafts clock's tick the result was asked for at (appDraftsManager.getDraftsClock)
    draftsAskedAt?: number
  ) {
    // * В эту функцию попадут только те диалоги, в которых есть read_inbox_max_id и read_outbox_max_id, в отличие от тех, что будут в getTopMessages

    const isSaved = result._ === 'messages.savedDialogs';
    const isDialog = !isSaved;
    const items = result.dialogs;
    if(isDialog) {
      this.filterDialogsForStorage(result.dialogs, undefined, settingsAskedAt);
    }

    this.appMessagesManager.saveApiResult(result);

    // this.appMessagesManager.log('applyConversation', dialogsResult);

    const updatedDialogs: BroadcastEvents['dialogs_multiupdate'] = new Map();
    const getUpdateCache = (peerId: PeerId) => {
      let cache = updatedDialogs.get(peerId);
      if(!cache) {
        updatedDialogs.set(peerId, cache = {});
      }

      return cache;
    };

    items.forEach((dialog) => {
      assumeType<AnyDialog>(dialog);
      const peerId = this.getDialogPeerId(dialog);
      let topMid = dialog.top_message;

      const {pendingTopMsgs} = this.appMessagesManager;
      let pendingTopMsgKey: keyof typeof pendingTopMsgs, dialogKey: number;
      if(isDialog) {
        pendingTopMsgKey = peerId;
      } else {
        dialogKey = getPeerId((dialog as SavedDialog).peer);
        pendingTopMsgKey = `${peerId}_${dialogKey}`;
      }

      const topPendingMid = pendingTopMsgs[pendingTopMsgKey];
      if(topPendingMid) {
        const topPendingMessage = this.appMessagesManager.getMessageByPeer(peerId, topPendingMid) as MyMessage;
        const topMessage = this.appMessagesManager.getMessageByPeer(peerId, topMid) as MyMessage;
        if(!topMid || (topPendingMessage && (!topMessage || topPendingMessage?.date > topMessage?.date))) {
          dialog.top_message = topMid = topPendingMid;
          this.appMessagesManager.getHistoryStorage(peerId, dialogKey)._maxId = topPendingMid;
        }
      }

      if(topMid || (dialog as Dialog).draft?._ === 'draftMessage') {
        if(this.saveDialog({dialog, keepPlace: true, settingsAskedAt, draftsAskedAt})) {
          const cache = getUpdateCache(peerId);

          if(isSaved) {
            (cache.saved ??= new Map()).set(
              (dialog as SavedDialog).savedPeerId,
              dialog as SavedDialog
            );
          } else {
            cache.dialog = dialog as Dialog;
          }
        }
      } else {
        this.dropDialogWithEvent(peerId, dialogKey);
      }

      const key = this.appMessagesManager.getUpdateAfterReloadKey(peerId, dialogKey);
      const updates = this.appMessagesManager.newUpdatesAfterReloadToHandle[key];
      if(updates !== undefined) {
        const slicedUpdates = [...updates]; // ! have to clone set, otherwise will have infinite loop if element is inserted again
        for(const update of slicedUpdates) {
          updates.delete(update);
          this.apiUpdatesManager.saveUpdate(update);
        }

        if(!updates.size) {
          delete this.appMessagesManager.newUpdatesAfterReloadToHandle[key];
        }
      }
    });

    if(updatedDialogs.size) {
      this.rootScope.dispatchEvent('dialogs_multiupdate', updatedDialogs);
    }
  }

  public filterDialogsForStorage(
    dialogs: MTDialog[],
    onPinnedOrder?: (order: PeerId[]) => void,
    settingsAskedAt?: number
  ): MTDialog.dialog[] {
    if(onPinnedOrder) {
      onPinnedOrder(dialogs.flatMap((dialog) => {
        if(!dialog.pFlags?.pinned) {
          return [];
        } else if(dialog._ === 'dialog') {
          return [this.appPeersManager.getPeerId(dialog.peer)];
        }

        return [];
      }));
    }

    forEachReverse(dialogs, (dialog, idx, arr) => {
      // * Signal has no communities
      if(dialog._ === 'dialogCommunity') {
        arr.splice(idx, 1);
      } else if(dialog._ === 'dialogFolder') {
        // ! fix 'dialogFolder', maybe there is better way to do it, this only can happen by 'messages.getPinnedDialogs' by folder_id: 0
        arr.splice(idx, 1);
      }
    });

    return dialogs as MTDialog.dialog[];
  }

  // ! do not use draft here, empty dialogs with drafts are excluded from .getDialogs response
  private getDialogOffsetDate(dialog: AnyDialog) {
    const message = this.getDialogMessageForState(dialog);
    return message?.date || 0;
  }

  private setDialogOffsetDate(folderId: number, offsetDate: number) {
    this.log('setting offset date', folderId, offsetDate);
    return this.dialogsOffsetDate[folderId] = offsetDate;
  }

  public canSaveDialog(peerId: PeerId, dialog: Dialog) {
    if(peerId.isAnyChat()) {
      const chat: Chat = this.appChatsManager.getChat(peerId.toChatId());
      // ! chatForbidden stays for chat where you're kicked. TeleSignal: a group we are no longer in (left, removed or
      // ended) stays in the list with its history, as in Web A and Signal Desktop
      if(chat._ === 'channelForbidden') {
        return false;
      }
    } else if(this.appUsersManager.isDeleted(peerId.toUserId()) && !getServerMessageId(dialog.top_message)) {
      return false;
    }

    return true;
  }

  public getDialogPeerId(dialog: AnyDialog) {
    const {peerId} = dialog;
    if(peerId) {
      return peerId;
    }

    if(isSavedDialog(dialog)) {
      return this.appPeersManager.peerId;
    }

    return this.appPeersManager.getPeerId(dialog.peer);
  }

  /**
   * A dialog's notification settings go to appNotificationsManager, unless they are older than what changed there
   * since the dialog was asked for (`settingsAskedAt`): then the dialog carries what is kept instead
   */
  private saveDialogNotifySettings(
    dialog: AnyDialog,
    target: {peerId?: PeerId, threadId?: number},
    settingsAskedAt: number
  ) {
    const dialogWithSettings = dialog as MTDialog.dialog;
    const kept = this.appNotificationsManager.savePeerSettings({
      ...target,
      settings: dialogWithSettings.notify_settings,
      askedAt: settingsAskedAt
    });
    if(kept && kept !== dialogWithSettings.notify_settings) {
      dialogWithSettings.notify_settings = kept;
    }
  }

  /**
   * Won't save migrated from peer, forbidden peers, left and kicked
   */
  public saveDialog({
    dialog,
    ignoreOffsetDate,
    saveGlobalOffset,
    keepPlace,
    settingsAskedAt,
    draftsAskedAt
  }: {
    dialog: AnyDialog | MTDialog.dialogCommunity,
    ignoreOffsetDate?: boolean,
    saveGlobalOffset?: boolean,
    // * a dialog refreshed on its own keeps its place among those of its date; a page of the list takes the
    // * server's order instead
    keepPlace?: boolean,
    // * the notification settings clock's tick the dialog was asked for at (appNotificationsManager.getSettingsClock)
    settingsAskedAt?: number,
    // * the drafts clock's tick the dialog was asked for at (appDraftsManager.getDraftsClock)
    draftsAskedAt?: number
  }) {
    if(dialog._ === 'dialogCommunity') {
      return false;
    }

    const isSaved = isSavedDialog(dialog);
    const _isDialog = isDialog(dialog);

    const peerId = this.getDialogPeerId(dialog);
    const channelId = this.appPeersManager.isChannel(peerId) ? peerId.toChatId() : undefined;

    const savedPeerId = isSaved ? getPeerId(dialog.peer) : undefined;
    const savedId = isSaved ? savedPeerId : undefined;
    // * the server stamps 'folder_id' on every dialog that lives outside the main folder, in
    // * folder-scoped answers too, so its absence always means the main folder
    const folderId: REAL_FOLDER_ID = _isDialog ? (dialog.folder_id ?? FOLDER_ID_ALL) : undefined;

    if(!peerId) {
      this.log.error('saveConversation no peerId???', dialog, folderId);
      return false;
    }

    if(_isDialog && !channelId && peerId.isAnyChat()) {
      const chat = this.appChatsManager.getChat(peerId.toChatId()) as Chat.chat;
      if(chat && chat.migrated_to && chat.pFlags.deactivated) {
        const migratedToPeer = this.appPeersManager.getPeerId(chat.migrated_to);
        this.appMessagesManager.migratedFromTo[peerId] = migratedToPeer;
        this.appMessagesManager.migratedToFrom[migratedToPeer] = peerId;
        dialog.migratedTo = migratedToPeer;
        // return;
      }
    }

    if(_isDialog && !this.canSaveDialog(peerId, dialog)) {
      return false;
    }

    if(_isDialog && !dialog.migratedTo) {
      const peerText = this.appPeersManager.getPeerSearchText(peerId);
      this.dialogsIndex.indexObject(peerId, peerText);
    }

    const wasDialogBefore = this.getAnyDialog(peerId, savedId);
    const wasDateIndex = keepPlace && wasDialogBefore && this.dateIndexes.get(wasDialogBefore);
    if(wasDateIndex) {
      this.dateIndexes.set(dialog, wasDateIndex);
    }

    let mid: number, message: MyMessage;
    if(dialog.top_message || true) {
      mid = this.appMessagesIdsManager.generateMessageId(dialog.top_message, channelId);// dialog.top_message;

      // preserve outgoing message
      const wasTopMessage = wasDialogBefore?.top_message && this.appMessagesManager.getMessageByPeer(peerId, wasDialogBefore.top_message) as MyMessage;
      if(wasTopMessage?.pFlags?.is_outgoing && wasDialogBefore.top_message >= mid) {
        mid = wasDialogBefore.top_message;
      }

      message = this.appMessagesManager.getMessageByPeer(peerId, mid);
    }/*  else {
      mid = this.appMessagesManager.generateTempMessageId(peerId);
      message = {
        _: 'message',
        id: mid,
        mid,
        from_id: this.appPeersManager.getOutputPeer(this.appUsersManager.getSelf().id.toPeerId(false)),
        peer_id: this.appPeersManager.getOutputPeer(peerId),
        pFlags: {out: true},
        date: 0,
        message: ''
      };
      this.appMessagesManager.saveMessages([message], {isOutgoing: true});
    } */

    // if(!message?.pFlags) {
    //   this.appMessagesManager.log.error('saveConversation no message:', dialog, message);
    // }

    dialog.top_message = mid;
    // dialog.unread_count = wasDialogBefore && dialog.read_inbox_max_id === getServerMessageId(wasDialogBefore.read_inbox_max_id) ? wasDialogBefore.unread_count : dialog.unread_count;
    if(!isSaved) {
      dialog.read_inbox_max_id = this.appMessagesIdsManager.generateMessageId(wasDialogBefore && !dialog.read_inbox_max_id ? (wasDialogBefore as typeof dialog).read_inbox_max_id : dialog.read_inbox_max_id, channelId);
      dialog.read_outbox_max_id = this.appMessagesIdsManager.generateMessageId(wasDialogBefore && !dialog.read_outbox_max_id ? (wasDialogBefore as typeof dialog).read_outbox_max_id : dialog.read_outbox_max_id, channelId);

      // Stale-snapshot guard: if local read state has advanced past what the
      // server snapshot reports (e.g. user just read messages locally and a
      // delayed reloadConversation result lands afterwards), preserve the
      // local read cursor and unread counts. Otherwise the counter visibly
      // jumps back up before the next read brings it down again — looks
      // like the unread count "duplicated".
      if(wasDialogBefore) {
        const wasReadInbox = (wasDialogBefore as typeof dialog).read_inbox_max_id;
        const wasReadOutbox = (wasDialogBefore as typeof dialog).read_outbox_max_id;
        const wasUnread = (wasDialogBefore as typeof dialog).unread_count;
        const wasUnreadMentions = (wasDialogBefore as typeof dialog).unread_mentions_count;
        const wasUnreadReactions = (wasDialogBefore as typeof dialog).unread_reactions_count;
        const wasUnreadPollVotes = (wasDialogBefore as typeof dialog).unread_poll_votes_count;

        if(wasReadInbox > dialog.read_inbox_max_id) {
          dialog.read_inbox_max_id = wasReadInbox;
          if(typeof wasUnread === 'number') {
            dialog.unread_count = Math.min(dialog.unread_count, wasUnread);
          }
          if(typeof wasUnreadMentions === 'number') {
            dialog.unread_mentions_count = Math.min(dialog.unread_mentions_count, wasUnreadMentions);
          }
          if(typeof wasUnreadReactions === 'number') {
            dialog.unread_reactions_count = Math.min(dialog.unread_reactions_count, wasUnreadReactions);
          }
          if(typeof wasUnreadPollVotes === 'number') {
            dialog.unread_poll_votes_count = Math.min(dialog.unread_poll_votes_count, wasUnreadPollVotes);
          }
        }

        if(wasReadOutbox > dialog.read_outbox_max_id) {
          dialog.read_outbox_max_id = wasReadOutbox;
        }
      }
    }

    if(_isDialog && dialog.folder_id === undefined) {
      if(dialog._ === 'dialog') {
        dialog.folder_id = folderId;
      }/*  else if(dialog._ === 'dialogFolder') {
        dialog.folder_id = dialog.folder.id;
      } */
    }

    // * a dialog can only be pinned in the folder it lives in. When the move is learned from a
    // * dialogs answer instead of 'updateFolderPeers' (offline while it happened, another device),
    // * nothing drops the peer from the old folder's order — and the order is persisted, so the
    // * dead entry silently eats a slot of that folder's pin limit forever
    if(_isDialog && wasDialogBefore) {
      const wasFolderId = (wasDialogBefore as typeof dialog).folder_id ?? FOLDER_ID_ALL;
      if(wasFolderId !== folderId && indexOfAndSplice(this.getPinnedOrders(wasFolderId), peerId) !== undefined) {
        this.savePinnedOrders();
      }
    }

    if(!isSaved) {
      dialog.draft = this.appDraftsManager.saveDraft({
        peerId,
        draft: dialog.draft,
        cloud: true,
        askedAt: draftsAskedAt
      });
    } else {
      dialog.savedPeerId = savedPeerId;
    }
    dialog.peerId = peerId;
    // dialog.indexes ??= {} as any;

    // * Because we saved message without dialog present
    if(!isSaved && message && message.pFlags.is_outgoing) {
      const isOut = message.pFlags.out;
      const maxId = dialog[isOut ? 'read_outbox_max_id' : 'read_inbox_max_id'];
      if(mid > maxId) {
        message.pFlags.unread = true;

        if(!dialog.unread_count && !isOut) {
          ++dialog.unread_count;
        }
      } else {
        delete message.pFlags.unread;
      }
    }

    const historyStorage = this.appMessagesManager.getHistoryStorage(peerId, savedId);
    const slice = historyStorage.history.slice;
    if(!mid) {

    } else if(!slice.length || !slice.isEnd(SliceEnd.Bottom)) {  // * second condition will probably never happen, however, if it does, then it will fix slice with top_message
      historyStorage.history.unshift(mid);
      historyStorage.count ||= historyStorage.history.length;

      if(historyStorage.originalInsertSlice) {
        this.appMessagesManager.insertChannelJoinedService(peerId, historyStorage, historyStorage.history.slice);
      }
    } else if(_isDialog && !wasDialogBefore) {
      this.appMessagesManager.insertChannelJoinedService(peerId, historyStorage);
    }

    // * if set channel joined message
    if(_isDialog && dialog.top_message < historyStorage.history.first[0]) {
      mid = dialog.top_message = historyStorage.history.first[0];
      dialog.topMessage = this.appMessagesManager.getMessageByPeer(peerId, dialog.top_message);
    }

    historyStorage._maxId = mid;
    if(!isSaved) {
      historyStorage.readMaxId = dialog.read_inbox_max_id;
      historyStorage.readOutboxMaxId = dialog.read_outbox_max_id;

      this.saveDialogNotifySettings(dialog, {peerId}, settingsAskedAt);
    }

    if(_isDialog && channelId && dialog.pts) {
      this.apiUpdatesManager.addChannelState(channelId, dialog.pts);
    }

    this.generateIndexForDialog(dialog);

    if(wasDialogBefore) {
      // fix unread count
      const releaseUnreadCount = this.dialogsStorage.prepareDialogUnreadCountModifying(wasDialogBefore);
      safeReplaceObject(wasDialogBefore, dialog);
      releaseUnreadCount();
    }

    this.pushDialog({
      dialog,
      ignoreOffsetDate,
      saveGlobalOffset
    });

    return true;
  }

  /**
   * A custom folder is tested against contacts and holds peers that may still be missing - both
   * have to be there before its dialogs are read
   */
  private prepareFolderForFilter(filterId: number) {
    if(this.isVirtualFilter(filterId) || REAL_FOLDERS.has(filterId)) {
      return;
    }

    const promises: Promise<any>[] = [];

    const fillContactsResult = this.appUsersManager.fillContacts();
    if(!fillContactsResult.cached) {
      promises.push(fillContactsResult.promise);
    }

    const reloadMissingDialogsPromise = this.filtersStorage.reloadMissingPeerIds(filterId);
    if(reloadMissingDialogsPromise) {
      promises.push(reloadMissingDialogsPromise);
    }

    return promises.length ? Promise.all(promises) : undefined;
  }

  /**
   * Where the page below `offsetIndex` starts in dialogs sorted by `indexKey`
   */
  private getOffsetByIndex(
    dialogs: Folder['dialogs'],
    offsetIndex: number,
    indexKey: ReturnType<typeof getDialogIndexKey>
  ) {
    let offset = 0;
    if(offsetIndex > 0) {
      for(const length = dialogs.length; offset < length; ++offset) {
        if(offsetIndex > this.getDialogIndex(dialogs[offset], indexKey)) {
          break;
        }
      }
    }

    return offset;
  }

  public getDialogs(options: {
    query?: string,
    offsetIndex?: number,
    limit?: number,
    filterId?: number,
    skipMigrated?: boolean,
    forceLocal?: boolean,
    recursion?: boolean,
    filterType?: FilterType
  }): MaybePromise<{
    dialogs: Folder['dialogs'],
    count: number,
    isTopEnd: boolean,
    isEnd: boolean
  }> {
    const {
      query = '',
      offsetIndex,
      limit = 20,
      filterId = FOLDER_ID_ALL,
      filterType = this.getFilterType(filterId),
      skipMigrated = false,
      forceLocal,
      recursion
    } = options;

    const isVirtualFilter = this.isVirtualFilter(filterId);
    const preparePromise = this.prepareFolderForFilter(filterId);
    if(preparePromise) {
      return preparePromise.then(() => {
        return this.getDialogs(options);
      });
    }

    // let's load only first pages by certain folderId. next pages will load without folder filtering
    const realFolderId/* : REAL_FOLDER_ID */ =
      (!REAL_FOLDERS.has(filterId) || this.getOffsetDate(filterId)) && !isVirtualFilter ?
        GLOBAL_FOLDER_ID :
        filterId/*  as REAL_FOLDER_ID */;
    let curDialogStorage = this.getFolderDialogs(filterId, skipMigrated);

    const indexKey = this.getDialogIndexKeyByFilterId(filterId);
    const isSearchSupported = filterType !== FilterType.Saved;

    if(TEST_NO_SAVED && filterType === FilterType.Saved) {
      throw makeError('SAVED_DIALOGS_UNSUPPORTED');
    }

    if(query && isSearchSupported) {
      if(!limit || this.cachedResults.query !== query || this.cachedResults.folderId !== filterId || recursion) {
        this.cachedResults.query = query;
        this.cachedResults.folderId = filterId;

        const results = this.dialogsIndex.search(query);

        const dialogs: DialogsStorage['cachedResults']['dialogs'] = [];
        for(const peerId of results) {
          const dialog = this.dialogs[peerId];
          if(dialog && dialog.folder_id === filterId) {
            dialogs.push(dialog);
          }
        }

        dialogs.sort((d1, d2) => this.getDialogIndex(d2, indexKey) - this.getDialogIndex(d1, indexKey));
        this.cachedResults.dialogs = dialogs;
        this.cachedResults.count = dialogs.length;
      }

      curDialogStorage = this.cachedResults.dialogs;
    } else {
      this.cachedResults.query = '';
    }

    let offset = this.getOffsetByIndex(curDialogStorage, offsetIndex, indexKey);

    const loadedAll = this.isDialogsLoaded(realFolderId);
    const isEnoughDialogs = curDialogStorage.length >= (offset + limit);
    if(query || loadedAll || isEnoughDialogs || forceLocal) {
      const dialogs = curDialogStorage.slice(offset, offset + limit);
      return {
        dialogs,
        count: loadedAll ? curDialogStorage.length : this.getFolder(filterId).count,
        isTopEnd: curDialogStorage.length && ((dialogs[0] && dialogs[0] === curDialogStorage[0]) || this.getDialogIndex(curDialogStorage[0], indexKey) < offsetIndex),
        isEnd: (query || loadedAll) && (offset + limit) >= curDialogStorage.length
      };
    }

    return this.appMessagesManager.getTopMessages({
      limit,
      folderId: realFolderId,
      query
    }).then((result) => {
      if(query) {
        return this.getDialogs({
          ...options,
          forceLocal: true,
          recursion: true
        });
      }

      const folder = this.getFolder(filterId);
      folder.count = result.count;

      if(skipMigrated) {
        curDialogStorage = this.getFolderDialogs(filterId, skipMigrated);
      }

      offset = this.getOffsetByIndex(curDialogStorage, offsetIndex, indexKey);

      // this.log.warn(offset, offset + limit, curDialogStorage.dialogs.length, this.dialogs.length);

      const dialogs = curDialogStorage.slice(offset, offset + limit);
      return {
        dialogs,
        count: result.isEnd ? curDialogStorage.length : result.count ?? curDialogStorage.length,
        isTopEnd: curDialogStorage.length && ((dialogs[0] && dialogs[0] === curDialogStorage[0]) || this.getDialogIndex(curDialogStorage[0], indexKey) < offsetIndex),
        // isEnd: this.isDialogsLoaded(realFolderId) && (offset + limit) >= curDialogStorage.length
        isEnd: result.isEnd && curDialogStorage[curDialogStorage.length - 1] === dialogs[dialogs.length - 1]
      };
    });
  }

  /**
   * The chats of a real folder whose titles match `query`. Only the loaded part of a folder is
   * indexed, so until it is loaded in full the server's own matches are taken too, once their
   * dialogs tell which folder they are in.
   */
  public async searchFolderDialogs(query: string, folderId: REAL_FOLDER_ID, limit = 20): Promise<PeerId[]> {
    const loadedAll = this.isDialogsLoaded(folderId);
    const [{dialogs}, serverPeerIds] = await Promise.all([
      this.getDialogs({query, filterId: folderId, limit}),
      loadedAll ? [] as PeerId[] : this.appUsersManager.searchContacts(query, limit).then(
        ({my_results}) => my_results,
        () => [] as PeerId[]
      )
    ]);

    const peerIds = new Set(dialogs.map((dialog) => dialog.peerId));
    // * a dialog older than the loaded part of its folder is not kept, so its folder is read off the answer
    const serverDialogs = await Promise.all(serverPeerIds.map((peerId) => {
      return this.getDialogOnly(peerId) ?? this.appMessagesManager.reloadConversation(peerId).catch(noop);
    }));

    for(const dialog of serverDialogs) {
      if(dialog && (dialog.folder_id ?? FOLDER_ID_ALL) === folderId) {
        peerIds.add(dialog.peerId);
      }
    }

    return [...peerIds].slice(0, limit);
  }

  /**
   * A page of the folder's unread dialogs - the ones its unread counter counts, so a chat marked
   * as unread is too - and of `keepPeerIds`, the ones a
   * list keeps since it was built although they are read now. Unread dialogs can be anywhere in
   * the folder, so it waits for every dialog to be loaded; `unreadPeerIds` is the whole folder's.
   */
  public async getUnreadDialogs({
    filterId,
    offsetIndex,
    limit = 20,
    skipMigrated = true,
    keepPeerIds
  }: {
    filterId: number,
    offsetIndex?: number,
    limit?: number,
    skipMigrated?: boolean,
    keepPeerIds?: PeerId[]
  }) {
    await Promise.all([
      this.prepareFolderForFilter(filterId),
      this.appMessagesManager.fillConversations()
    ]);

    const {unreadPeerIds} = this.getFolder(filterId);
    const kept = new Set(keepPeerIds);
    const unreadDialogs = this.getFolderDialogs(filterId, skipMigrated).filter((dialog) => {
      const key = getDialogKey(dialog);
      return unreadPeerIds.has(key) || kept.has(key);
    });

    const offset = this.getOffsetByIndex(unreadDialogs, offsetIndex, this.getDialogIndexKeyByFilterId(filterId));
    return {
      dialogs: unreadDialogs.slice(offset, offset + limit),
      count: unreadDialogs.length,
      isEnd: offset + limit >= unreadDialogs.length,
      unreadPeerIds: [...unreadPeerIds]
    };
  }

  public async markFolderAsRead(folderId: number) {
    const peerIds = [...this.getFolder(folderId).unreadPeerIds];
    for(const peerId of peerIds) {
      await this.appMessagesManager.markDialogUnread({peerId, read: true});
    }
  }

  // * SAVED SECTION

  public getSavedDialogById(peerId: PeerId) {
    let promise = this.savedDialogsPromises.get(peerId);
    if(promise) {
      return promise;
    }

    const myId = this.appPeersManager.peerId;
    promise = this.apiManager.invokeApi('messages.getSavedHistory', {
      peer: this.appPeersManager.getInputPeerById(peerId),
      add_offset: 0,
      hash: 0,
      limit: 1,
      max_id: 0,
      min_id: 0,
      offset_date: 0,
      offset_id: 0
    }).then((messagesMessages) => {
      assumeType<Exclude<MessagesMessages, MessagesMessages.messagesMessagesNotModified>>(messagesMessages);

      if(this.savedDialogsPromises.get(peerId) === promise) {
        this.savedDialogsPromises.delete(peerId);
      }

      this.appMessagesManager.saveApiResult(messagesMessages);

      const messages = messagesMessages.messages;
      const message = messages[0];
      if(!message) {
        this.log('reloaded saved dialog is empty', peerId);
        this.dropDialogOnDeletion(myId, peerId);
        return;
      }

      const pinnedOrder = this.getPinnedOrders(myId);
      const dialog: SavedDialog = {
        _: 'savedDialog',
        peer: this.appPeersManager.getOutputPeer(peerId),
        pFlags: {
          pinned: pinnedOrder.includes(peerId) || undefined
        },
        top_message: message.id || 0
      };

      this.log('saving reloaded saved dialog', peerId);
      this.applyDialogs({
        _: 'messages.savedDialogs',
        dialogs: [dialog]
      });

      return dialog.peerId ? dialog : undefined;
    });
  }

  // * SAVED SECTION END

  /**
   * `peerId`: whose dialog it is, and `savedPeerId` which of Saved Messages' - also without it at hand: one
   * pinned elsewhere that is not loaded here is asked for (handleNewDialogs reloads it), as handleDialogsPinned
   * does with a pin order
   */
  private handleDialogTogglePinned(dialog: AnyDialog, pinned: boolean, folderId: number, peerId: PeerId, savedPeerId?: PeerId) {
    if(dialog) {
      if(!pinned) {
        this.handleDialogUnpinning(dialog, folderId);
      } else { // means set
        dialog.pFlags.pinned = true;
      }

      this.generateIndexForDialog(dialog);
    }

    this.appMessagesManager.scheduleHandleNewDialogs(peerId, dialog ?? savedPeerId);
  }

  public handleDialogsPinned(folderId: number, order: (Dialog['peerId'] | SavedDialog['savedPeerId'])[]) {
    const isVirtualFolder = folderId === this.appPeersManager.peerId;
    order = order.slice();
    this.resetPinnedOrder(folderId);
    this.getPinnedOrders(folderId).push(...order);
    this.savePinnedOrders();
    order.reverse(); // index must be higher
    const newPinned: {[id: typeof order[0]]: true} = {};
    order.forEach((id) => {
      newPinned[id] = true;

      const peerId = isVirtualFolder ? folderId : id;
      const savedId = isVirtualFolder ? id : undefined;

      const dialog = this.getAnyDialog(peerId, savedId);
      this.appMessagesManager.scheduleHandleNewDialogs(peerId, dialog);
      if(!dialog) {
        return;
      }

      dialog.pFlags.pinned = true;
      this.generateIndexForDialog(dialog);
    });

    const dialogs = this.getFolderDialogs(folderId, false);
    for(const dialog of dialogs) {
      if(!dialog.pFlags.pinned) {
        break;
      }

      if(!newPinned[getDialogKey(dialog)]) {
        delete dialog.pFlags.pinned;
        this.generateIndexForDialog(dialog);
        this.appMessagesManager.scheduleHandleNewDialogs(dialog.peerId, dialog);
      }
    }
  }

  // only 0 and 1 folders
  private onUpdateFolderPeers = (update: Update.updateFolderPeers) => {
    // this.log('updateFolderPeers', update);
    const peers = update.folder_peers;

    peers.forEach((folderPeer) => {
      const {folder_id, peer} = folderPeer;

      const peerId = this.appPeersManager.getPeerId(peer);
      const dialog = this.dropDialogFromFolders(peerId, undefined, true)[0] as Dialog;
      if(dialog) {
        if(dialog.pFlags?.pinned) {
          // * the pin belongs to the folder the dialog is LEAVING, not to the one it moves to
          this.handleDialogUnpinning(dialog, dialog.folder_id ?? FOLDER_ID_ALL);
        }

        (dialog as Dialog).folder_id = folder_id as REAL_FOLDER_ID;
        this.generateIndexForDialog(dialog);
        this.pushDialog({dialog}); // need for simultaneously updatePinnedDialogs
      }

      this.appMessagesManager.scheduleHandleNewDialogs(peerId, dialog);
    });
  };

  private onUpdateDialogPinned = (update: Update.updateDialogPinned | Update.updateSavedDialogPinned) => {
    if(update.peer._ !== 'dialogPeer') {
      return;
    }

    const peerId = this.appPeersManager.getPeerId(update.peer.peer);
    let dialog: AnyDialog, folderId: number;
    if(update._ === 'updateDialogPinned') {
      folderId = update.folder_id ?? FOLDER_ID_ALL;
      // this.log('updateDialogPinned', update);
      dialog = this.getDialogOnly(peerId);
    } else {
      folderId = this.appPeersManager.peerId;
      dialog = this.getAnyDialog(this.appPeersManager.peerId, peerId);
    }

    // этот код внизу никогда не сработает, в папках за пиннед отвечает updateDialogFilter
    /* if(update.folder_id > 1) {
      const filter = this.filtersStorage.filters[update.folder_id];
      if(update.pFlags.pinned) {
        filter.pinned_peers.unshift(peerId);
      } else {
        filter.pinned_peers.findAndSplice((p) => p === peerId);
      }
    } */

    const isSaved = update._ === 'updateSavedDialogPinned';
    // * the pin order takes the pin at once, in the order the pins come: a dialog takes its place from it only
    // * when it is indexed later (handleNewDialogs) or asked for (one not loaded; getSavedDialogById rebuilds a
    // * Saved Messages subdialog's pin from it), and pins of one batch must not swap places meanwhile
    this.togglePinInOrder(folderId, peerId, !!update.pFlags.pinned);

    this.handleDialogTogglePinned(
      dialog,
      update.pFlags.pinned,
      folderId,
      isSaved ? this.appPeersManager.peerId : peerId,
      isSaved ? peerId : undefined
    );
  };

  private onUpdatePinnedDialogs = (update: Update.updatePinnedDialogs | Update.updatePinnedSavedDialogs) => {
    const isSaved = update._ === 'updatePinnedSavedDialogs';
    let folderId: number;
    if(isSaved) {
      folderId = this.appPeersManager.peerId;
    } else {
      folderId = update.folder_id ?? FOLDER_ID_ALL;
    }

    if(update.order) {
      const order = update.order.flatMap((peer) => {
        if(peer._ === 'dialogPeer') {
          return [this.appPeersManager.getPeerId(peer.peer)];
        }

        return [];
      });
      this.handleDialogsPinned(folderId, order);
    } else {
      type S = Modify<MessagesSavedDialogs.messagesSavedDialogs, {dialogs: Array<SavedDialog>}>;
      let promise: Promise<{
        result: MessagesPeerDialogs | S,
        cutoffGeneration?: string | number,
        settingsAskedAt?: number,
        draftsAskedAt?: number
      }>;
      if(isSaved) {
        promise = (this.apiManager.invokeApi('messages.getPinnedSavedDialogs') as Promise<S>)
        .then((result) => ({result}));
      } else {
        promise = (async() => {
          for(let attempt = 0; ; ++attempt) {
            const cutoffGeneration = this.appMessagesManager.getChannelAvailableMinIdGeneration();
            const settingsAskedAt = this.appNotificationsManager.getSettingsClock();
            const draftsAskedAt = this.appDraftsManager.getDraftsClock();
            const result = await this.apiManager.invokeApi('messages.getPinnedDialogs', {
              folder_id: folderId
            });
            if(
              cutoffGeneration === this.appMessagesManager.getChannelAvailableMinIdGeneration() ||
              attempt >= CHANNEL_CUTOFF_RETRY_LIMIT
            ) {
              return {result, cutoffGeneration, settingsAskedAt, draftsAskedAt};
            }
          }
        })();
      }

      promise.then(({result, cutoffGeneration, settingsAskedAt, draftsAskedAt}) => {
        if(
          cutoffGeneration !== undefined &&
          cutoffGeneration !== this.appMessagesManager.getChannelAvailableMinIdGeneration()
        ) {
          this.onUpdatePinnedDialogs(update);
          return;
        }
        // * for test reordering and rendering
        // dialogsResult.dialogs.reverse();

        const order = result.dialogs.flatMap((dialog) => {
          if(dialog._ === 'dialog') {
            return [this.appPeersManager.getPeerId(dialog.peer)];
          }

          return [];
        });
        this.applyDialogs(result, undefined, settingsAskedAt, draftsAskedAt);

        this.handleDialogsPinned(folderId, order);
      });
    }
  };
}
