import {untrack} from 'solid-js';
import {Dialog} from '@appManagers/appMessagesManager';
import {FOLDER_ID_ALL, FOLDER_ID_ARCHIVE, REAL_FOLDERS} from '@appManagers/constants';
import getDialogIndex from '@appManagers/utils/dialogs/getDialogIndex';
import getDialogIndexKey from '@appManagers/utils/dialogs/getDialogIndexKey';
import {isDialog, isForumTopic} from '@appManagers/utils/dialogs/isDialog';
import {setRollingText} from '@components/animatedCounter';
import ArchiveDialog, {createArchiveDialogState, DisposableArchiveDialogState} from '@components/archiveDialog';
import {AutonomousDialogListBase, BaseConstructorArgs, LoadDialogsInnerArgs} from '@components/autonomousDialogList/base';
import {BADGE_TRANSITION_TIME} from '@components/autonomousDialogList/constants';
import groupCallActiveIcon from '@components/groupCallActiveIcon';
import Scrollable from '@components/scrollable';
import SetTransition from '@components/singleTransition';
import SortedDialogList, {CustomPinnedDialog} from '@components/sortedDialogList';
import IS_GROUP_CALL_SUPPORTED from '@environment/groupCallSupport';
import namedPromises from '@helpers/namedPromises';
import noop from '@helpers/noop';
import {Chat, Message} from '@layer';
import apiManagerProxy from '@lib/apiManagerProxy';
import {AppDialogsManager} from '@lib/appDialogsManager';
import {DialogDom} from '@components/dialogElement';
import rootScope from '@lib/rootScope';
import SolidJSHotReloadGuardProvider from '@lib/solidjs/hotReloadGuardProvider';
import {runWithHotReloadGuard} from '@lib/solidjs/runWithHotReloadGuard';
import useChatListUnreadOnly from '@stores/chatListUnreadOnly';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';

const [unreadOnly] = useChatListUnreadOnly();


type ConstructorArgs = BaseConstructorArgs & {
  filterId: number;
};

export class AutonomousDialogList extends AutonomousDialogListBase<Dialog> {
  protected filterId: number;
  private archiveDialogState?: DisposableArchiveDialogState;
  private customPinnedDialog?: CustomPinnedDialog;
  // * while the list shows only unread chats: the folder's chats that have been unread since it was
  // * built, from its counter (`folder_unread`). One read meanwhile stays until the list is built
  // * again - kept here, not by the rows the list holds, which it drops far out of sight
  private keptPeerIds: Set<PeerId>;
  // * which build of the list the set is of: every `clear` starts another
  private keptBuild = 0;

  constructor({filterId, ...args}: ConstructorArgs) {
    super(args);

    this.filterId = filterId;

    if(filterId === FOLDER_ID_ALL) {
      this.customPinnedDialog = new CustomPinnedDialog({
        render: () => {
          const element = new ArchiveDialog;
          element.HotReloadGuard = SolidJSHotReloadGuardProvider;

          element.feedProps({
            state: this.archiveDialogState.state
          });

          return element;
        }
      });

      this.archiveDialogState = runWithHotReloadGuard(() => createArchiveDialogState({
        onHasArchiveDialogChanged: (hasDialogs) => {
          this.onHasArchiveDialogChanged(hasDialogs);
        }
      }));
    }

    this.needPlaceholderAtFirstTime = true;

    this.listenerSetter.add(rootScope)('peer_typings', async({peerId, typings}) => {
      const [dialog, isForum] = await Promise.all([
        this.managers.appMessagesManager.getDialogOnly(peerId),
        this.managers.appPeersManager.isForum(peerId)
      ]);

      if(!dialog || isForum) return;

      if(typings.length) {
        this.setTyping(dialog);
      } else {
        this.unsetTyping(dialog);
      }
    });

    this.listenerSetter.add(rootScope)('user_update', async(userId) => {
      if(!this.isActive) {
        return;
      }

      const peerId = userId.toPeerId();
      const dialogElement = this.getDialogElement(peerId);
      if(!dialogElement) {
        return;
      }

      const status = await this.managers.appUsersManager.getUserStatus(userId);
      const online = status?._ === 'userStatusOnline';
      this.setOnlineStatus(dialogElement.dom.avatarEl.node, online);
    });

    this.listenerSetter.add(rootScope)('chat_update', async(chatId) => {
      const peerId = chatId.toPeerId(true);
      this.processDialogForCallStatus(peerId);
    });

    this.listenerSetter.add(rootScope)('dialog_flush', ({dialog}) => {
      if(!this.isActive || !dialog) {
        return;
      }

      this.updateDialog(dialog);
    });

    // Desktop repaints the chat-list row on every streamed revision
    // (HistoryStreamedDrafts::update -> HistoryItem::invalidateChatListEntry), so the row
    // previews the text as it arrives. A streamed draft never becomes the dialog's
    // top_message here, so pass it explicitly; passing nothing falls back to the real last
    // message, which is what the row must show again once the draft is gone.
    const setStreamedMessagePreview = async(peerId: PeerId, message?: Message.message) => {
      if(!this.isActive) {
        return;
      }

      const dialog = await this.managers.appMessagesManager.getDialogOnly(peerId);
      if(!dialog || !this.isActive) {
        return;
      }

      const dialogElement = this.getDialogElement(this.getDialogKey(dialog));
      if(!dialogElement) {
        return;
      }

      this.appDialogsManager.setLastMessageN({
        dialog,
        dialogElement,
        lastMessage: message,
        setUnread: true
      });
    };

    this.listenerSetter.add(rootScope)('streamed_message_update', ({draft, message}) => {
      setStreamedMessagePreview(draft.peerId, message);
    });

    // 'remove' has nothing else behind it — without this the row would keep previewing a
    // draft that has expired. 'finalize' is followed by the ordinary new-message pipeline,
    // but refreshing here too costs nothing and closes the gap until it runs.
    this.listenerSetter.add(rootScope)('streamed_message_remove', ({draft}) => {
      setStreamedMessagePreview(draft.peerId);
    });

    this.listenerSetter.add(rootScope)('streamed_message_finalize', ({draft}) => {
      setStreamedMessagePreview(draft.peerId);
    });

    this.listenerSetter.add(rootScope)('dialogs_multiupdate', (dialogs) => {
      if(!this.isActive) {
        return;
      }

      for(const [peerId, {dialog, topics}] of dialogs) {
        if(!isDialog(dialog)) {
          continue;
        }

        this.updateDialog(dialog);
        this.appDialogsManager.processContact(peerId.toPeerId());
      }
    });

    this.listenerSetter.add(rootScope)('dialog_drop', (dialog) => {
      if(!this.isActive || !isDialog(dialog)) {
        return;
      }

      this.deleteDialogByKey(this.getDialogKey(dialog));
      this.appDialogsManager.processContact(dialog.peerId);
    });

    this.listenerSetter.add(rootScope)('dialog_unread', ({dialog}) => {
      if(!this.isActive || !isDialog(dialog)) {
        return;
      }

      this.updateDialog(dialog);
    });

    // * a chat that turns unread joins a list of unread ones, and one that is read stays in it until
    // * the list is built again - the chat just opened does not slip away from under the pointer.
    // * The counter is updated after the dialog is, so the chat is added from here
    this.listenerSetter.add(rootScope)('folder_unread', (folder) => {
      const kept = this.keptPeerIds;
      if(folder.id !== this.filterId || !kept) {
        return;
      }

      const added = [...folder.unreadPeerIds].filter((peerId) => !kept.has(peerId));
      added.forEach((peerId) => kept.add(peerId));
      if(!this.isActive || !added.length) {
        return;
      }

      for(const peerId of added) {
        this.managers.appMessagesManager.getDialogOnly(peerId).then((dialog) => {
          if(dialog && this.keptPeerIds === kept) {
            this.updateDialog(dialog);
          }
        });
      }
    });

    this.listenerSetter.add(rootScope)('dialog_notify_settings', (dialog) => {
      if(!this.isActive || !isDialog(dialog)) {
        return;
      }

      this.updateDialog(dialog);
    });

    this.listenerSetter.add(rootScope)('dialog_draft', ({dialog, drop, peerId}) => {
      if(!this.isActive || isForumTopic(dialog)) {
        return;
      }

      if(drop) {
        this.deleteDialog(dialog);
      } else {
        this.updateDialog(dialog);
      }

      this.appDialogsManager.processContact(peerId);
    });

    this.listenerSetter.add(rootScope)('filter_update', async(filter) => {
      const managers = bindManagersToSession(this.managers);
      if(this.isActive && filter.id === this.filterId && !REAL_FOLDERS.has(filter.id)) {
        const dialogs = await managers.dialogsStorage.getCachedDialogs(true);
        await this.validateListForFilter();
        for(let i = 0, length = dialogs.length; i < length; ++i) {
          const dialog = dialogs[i];
          this.updateDialog(dialog);
        }

        if(this.appDialogsManager.filterId === this.filterId) {
          this.appDialogsManager.fetchChatlistUpdates?.();
        }
      }
    });

    this.listenerSetter.add(rootScope)('auto_delete_period_update', ({peerId, period}) => {
      this.getDialogElement(peerId)?.dom?.avatarEl?.setAutoDeletePeriod(period);
    });
  }

  private get isActive() {
    return this.appDialogsManager.xd === this;
  }

  // * read untracked: the list changes by being built again (`appDialogsManager.setUnreadOnly`),
  // * not by an effect that happened to read it - the archive row's would put it back at once
  private get isUnreadOnly() {
    return this.filterId !== FOLDER_ID_ARCHIVE && untrack(unreadOnly);
  }

  // * the chats the list lets in while it shows only some of the folder's, for stepping between them
  public getShownPeerIds() {
    return this.isUnreadOnly ? [...this.keptPeerIds ?? []] : undefined;
  }

  public getRectFromForPlaceholder() {
    return this.filterId === FOLDER_ID_ARCHIVE ? this.appDialogsManager.chatsContainer : this.appDialogsManager.folders.container;
  }

  protected getFilterId() {
    return this.filterId;
  }

  public setOnlineStatus(element: HTMLElement, online: boolean) {
    const className = 'is-online';
    const hasClassName = element.classList.contains(className);
    !hasClassName && online && element.classList.add(className);
    SetTransition({
      element: element,
      className: 'is-visible',
      forwards: online,
      duration: 250,
      onTransitionEnd: online ? undefined : () => {
        element.classList.remove(className);
      },
      useRafs: online && !hasClassName ? 2 : 0
    });
  }

  public generateScrollable(filter: Parameters<AppDialogsManager['addFilter']>[0]) {
    const filterId = filter.id;
    const scrollable = new Scrollable(null, 'CL', 500);
    scrollable.container.dataset.filterId = '' + filterId;

    const indexKey = getDialogIndexKey(filter.localId);
    const sortedDialogList = new SortedDialogList({
      appDialogsManager: this.appDialogsManager,
      managers: rootScope.managers,
      log: this.log,
      scrollable: scrollable,
      indexKey,
      requestItemForIdx: this.requestItemForIdx,
      onListShrinked: this.onListShrinked,
      itemSize: 72,
      folderTagsFilterId: filterId,
      onListLengthChange: () => {
        scrollable.onSizeChange();
        this.appDialogsManager.onListLengthChange?.();
      }
    });


    this.scrollable = scrollable;
    this.sortedList = sortedDialogList;
    this.setIndexKey(indexKey);
    this.bindScrollable();

    // a press on a chat row opens the chat, so the pinned block is dragged only in the mode where it
    // does not - the one the rows are selected in (Android reorders its pins there too). Not among
    // unread chats only: the order of the pins that are shown is not the order of all of them
    this.attachPinnedReorder(() => this.appDialogsManager.selection.isSelecting && !this.isUnreadOnly);

    // list.classList.add('hide');
    // scrollable.container.style.backgroundColor = '#' + (Math.random() * (16 ** 6 - 1) | 0).toString(16);

    return {scrollable, list: sortedDialogList.list};
  }

  public testDialogForFilter(dialog: Dialog) {
    if(!REAL_FOLDERS.has(this.filterId) ? getDialogIndex(dialog, this.indexKey) === undefined : this.filterId !== dialog.folder_id) {
      return false;
    }

    return !this.isUnreadOnly || !!this.keptPeerIds?.has(dialog.peerId);
  }

  protected async dialogsFetcher(offsetIndex: number, limit: number) {
    if(!this.isUnreadOnly) {
      return super.dialogsFetcher(offsetIndex, limit);
    }

    // * a page that comes back to a list built again since tells nothing about it. And the set comes
    // * with the first page, not before: until then no update adds a row - one added while every
    // * dialog is still loading would cut the first page short
    const build = this.keptBuild;
    const result = await this.managers.dialogsStorage.getUnreadDialogs({
      filterId: this.filterId,
      offsetIndex,
      limit,
      skipMigrated: this.skipMigrated,
      keepPeerIds: this.keptPeerIds && [...this.keptPeerIds]
    });

    if(build === this.keptBuild) {
      const kept = this.keptPeerIds ??= new Set();
      result.unreadPeerIds.forEach((peerId) => kept.add(peerId));
    }

    return result;
  }

  protected async loadDialogsInner({offsetIndex, canFinish}: LoadDialogsInnerArgs) {
    const isFirstLoad = !offsetIndex;

    const unblock = isFirstLoad ? this.sortedList.blockAnimation() : noop;
    try {
      const {result} = await namedPromises({
        result: super.loadDialogsInner({
          offsetIndex,
          removePlaceholder: false,
          canFinish
        }),
        _ignore: this.ensureArchiveDialogHydrated()
      });

      this.placeholder?.detach(this.sortedList.itemsLength());

      return {
        ...result,
        totalCount: this.sortedList.itemsLength()
      };
    } finally {
      unblock();
    }
  }

  private async ensureArchiveDialogHydrated() {
    if(!this.archiveDialogState) return;

    const promise = this.archiveDialogState.state.ensureHydrated();
    if(!promise) {
      await this.onHasArchiveDialogChanged(this.archiveDialogState.hasArchiveDialog());
      return;
    }

    const ackedResult = await promise;
    if(!ackedResult.cached) return;

    return ackedResult.result;
  }

  public getListElement(peerId: PeerId) {
    return this.getDialogElement(peerId)?.dom.listEl;
  }

  /**
   * Удалит неподходящие чаты из списка, но не добавит их(!)
   */
  public async validateListForFilter() {
    this.sortedList.getAllDialogElementsMap().forEach(async(_, key) => {
      const dialog = await rootScope.managers.appMessagesManager.getDialogOnly(key);
      if(!this.testDialogForFilter(dialog)) {
        this.deleteDialog(dialog);
      }
    });
  }

  public updateDialog(dialog: Dialog) {
    if(!this.testDialogForFilter(dialog)) {
      if(this.getDialogElement(dialog.peerId)) {
        this.deleteDialog(dialog);
      }

      return;
    }

    return super.updateDialog(dialog);
  }

  public setCallStatus(dom: DialogDom, visible: boolean) {
    let {callIcon, listEl} = dom;
    if(!callIcon && visible) {
      const {element} = dom.callIcon = callIcon = groupCallActiveIcon();
      element.classList.add('dialog-group-call-icon');
      listEl.append(element);

      listEl.classList.add('has-group-call-icon');
    }

    if(!callIcon) {
      return;
    }

    SetTransition({
      element: dom.callIcon.element,
      className: 'is-visible',
      forwards: visible,
      duration: BADGE_TRANSITION_TIME,
      onTransitionEnd: visible ? undefined : () => {
        dom.callIcon.element.remove();
        dom.callIcon = undefined;
        listEl.classList.remove('has-group-call-icon');
      },
      useRafs: visible ? 2 : 0
    });
  }

  public processDialogForCallStatus(peerId: PeerId, dom?: DialogDom) {
    if(!IS_GROUP_CALL_SUPPORTED) {
      return;
    }

    if(!dom) dom = this.getDialogDom(peerId);
    if(!dom) return;

    const chat = apiManagerProxy.getChat(peerId.toChatId()) as Chat.chat | Chat.channel;
    this.setCallStatus(dom, !!(chat.pFlags.call_active && chat.pFlags.call_not_empty));
  }

  protected onScrolledBottom() {
    super.onScrolledBottom();

    if(this.hasReachedTheEnd) {
      this.appDialogsManager.loadContacts();
    }
  }

  public toggleAvatarUnreadBadges(value: boolean, useRafs: number) {
    if(!value) {
      this.sortedList.getAllDialogElementsMap().forEach((dialogElement) => {
        const {dom} = dialogElement;
        if(!dom.unreadAvatarBadge) {
          return;
        }

        dialogElement.toggleBadgeByKey('unreadAvatarBadge', false, false, false);
      });

      return;
    }

    const reuseClassNames = ['unread', 'mention'];
    this.sortedList.getAllDialogElementsMap().forEach((dialogElement) => {
      const {dom} = dialogElement;
      // * not the badge's own text, which holds the rolling characters while its count changes
      const unreadContent = dialogElement.unreadText;
      if(
        !unreadContent ||
        !dom.unreadBadge ||
        dom.unreadBadge.classList.contains('backwards') ||
        dom.unreadBadge.classList.contains('dialog-pinned-icon')
      ) {
        return;
      }

      const isUnreadAvatarBadgeMounted = !!dom.unreadAvatarBadge;
      dialogElement.createUnreadAvatarBadge();
      dialogElement.toggleBadgeByKey('unreadAvatarBadge', true, isUnreadAvatarBadgeMounted);
      setRollingText({element: dom.unreadAvatarBadge, text: unreadContent, direction: 0, animate: false});
      const unreadAvatarBadgeClassList = dom.unreadAvatarBadge.classList;
      const unreadBadgeClassList = dom.unreadBadge.classList;
      reuseClassNames.forEach((className) => {
        unreadAvatarBadgeClassList.toggle(className, unreadBadgeClassList.contains(className));
      });
    });
  }

  public getDialogKey(dialog: Dialog) {
    return dialog.peerId;
  }

  public getDialogKeyFromElement(element: HTMLElement) {
    return +element.dataset.peerId;
  }

  public getDialogFromElement(element: HTMLElement) {
    return rootScope.managers.appMessagesManager.getDialogOnly(element.dataset.peerId.toPeerId());
  }

  protected canUpdateDialog(dialog: Dialog): boolean {
    if(dialog.migratedTo !== undefined || !this.testDialogForFilter(dialog)) return false;
    return super.canUpdateDialog(dialog);
  }

  private async onHasArchiveDialogChanged(hasArchiveDialog: boolean) {
    if(!this.customPinnedDialog || !this.archiveDialogState) return;

    // * the archive is no chat of its own, and its unread ones are not this list's
    if(hasArchiveDialog && !this.isUnreadOnly) {
      await this.sortedList.ensurePinned(this.customPinnedDialog);
    } else {
      this.sortedList.removePinned(this.customPinnedDialog);
    }
  }

  public clear(): void {
    this.keptPeerIds = undefined;
    ++this.keptBuild;
    super.clear();
  }

  public destroy(): void {
    super.destroy();
    this.archiveDialogState?.dispose();
  }
}
