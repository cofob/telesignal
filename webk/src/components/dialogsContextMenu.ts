import type {Dialog} from '@appManagers/appMessagesManager';
import type {ForumTopic} from '@layer';
import type {AnyDialog} from '@lib/storages/dialogs';
import {findDialogListElement} from '@components/dialogElement';
import rootScope from '@lib/rootScope';
import {useAppSettings} from '@stores/appSettings';
import {ButtonMenuItemOptionsVerifiable} from '@components/buttonMenu';
import showDeleteDialogPopup from '@components/popups/deleteDialog';
import {i18n, LangPackKey, _i18n} from '@lib/langPack';
import showMutePopup from '@components/popups/mute';
import {TabManagers} from '@lib/managers';
import {CAN_HIDE_TOPIC, FOLDER_ID_ARCHIVE, GENERAL_TOPIC_ID, REAL_FOLDER_ID, REAL_FOLDERS, REPLIES_PEER_ID, VERIFICATION_CODES_BOT_ID} from '@appManagers/constants';
import showPinLimitReached from '@components/showPinLimitReached';
import createContextMenu from '@helpers/dom/createContextMenu';
import showChatPreviewPopup, {chatPreviewAnchorFromDialogRow} from '@components/popups/chatPreview';
import cancelEvent from '@helpers/dom/cancelEvent';
import IS_SHARED_WORKER_SUPPORTED from '@environment/sharedWorkerSupport';
import {isDialog, isForumTopic, isMonoforumDialog, isSavedDialog} from '@appManagers/utils/dialogs/isDialog';
import createSubmenuTrigger, {CreateSubmenuArgs} from '@components/createSubmenuTrigger';
import type AddToFolderDropdownMenu from '@components/addToFolderDropdownMenu';
import memoizeAsyncWithTTL from '@helpers/memoizeAsyncWithTTL';
import {MonoforumDialog} from '@lib/storages/monoforumDialogs';
import apiManagerProxy from '@lib/apiManagerProxy';
import {hotReloadGuard} from '@lib/solidjs/hotReloadGuardProvider';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';
import blockUserWithConfirmation, {unblockUser} from '@components/blockUser';

export default class DialogsContextMenu {
  private buttons: ButtonMenuItemOptionsVerifiable[];

  private peerId: PeerId;
  private filterId: number;
  private threadId: number;
  private monoforumParentPeerId?: PeerId;
  private dialog: AnyDialog | MonoforumDialog;
  private canManageTopics: boolean;
  private canDelete: boolean;
  private li: HTMLElement;
  private addToFolderMenu: InstanceType<typeof AddToFolderDropdownMenu>;

  constructor(private managers: TabManagers, private options: {recentSearch?: boolean, useDialogFolder?: boolean} = {}) {

  }

  public attach(element: HTMLElement) {
    return createContextMenu({
      listenTo: element,
      buttons: this.getButtons(),
      onOpen: async(e, li) => {
        const managers = bindManagersToSession(this.managers);
        this.li = li;
        li.classList.add('menu-open');
        this.peerId = li.dataset.peerId.toPeerId();
        this.threadId = +li.dataset.threadId || undefined;
        this.monoforumParentPeerId = +li.dataset.monoforumParentPeerId || undefined;

        if(li.dataset.isAllChats) {
          throw 'All chats dialog';
        }

        // * Android shows no context menu while rows are being selected: the press belongs to the
        // * selection, and on touch it is also what starts a reorder of the pinned block
        const selection = hotReloadGuard.appDialogsManager.getSelectionForRow(li);
        if(selection?.isSelecting && selection.canSelect(li)) {
          throw 'Selecting dialogs';
        }

        this.dialog = this.monoforumParentPeerId ?
          await managers.monoforumDialogsStorage.getDialogByParent(this.monoforumParentPeerId, this.peerId):
          await managers.dialogsStorage.getAnyDialog(this.peerId, this.threadId);
        this.filterId = this.threadId ? undefined :
          this.options.useDialogFolder || this.options.recentSearch ?
            (isDialog(this.dialog) ? this.dialog.folder_id ?? 0 : 0) :
            hotReloadGuard.appDialogsManager.filterId;
        this.canManageTopics = isForumTopic(this.dialog) ? await managers.dialogsStorage.canManageTopic(this.dialog) : undefined;
        this.canDelete = await this.checkIfCanDelete();
      },
      onOpenBefore: async() => {
        this.buttons?.forEach(button => button?.onOpen?.());
        // delete button
        const langPackKey: LangPackKey = this.threadId ? 'Delete' : await this.managers.appPeersManager.getDeleteButtonText(this.peerId);
        const lastButton = this.buttons[this.buttons.length - 1];
        if(lastButton?.element) {
          lastButton.element.lastChild.replaceWith(i18n(langPackKey));
        }
      },
      onClose: () => {
        this.buttons?.forEach(button => button?.onClose?.());
        this.li?.classList.remove('menu-open');

        this.li =
        this.peerId =
        this.dialog =
        this.filterId =
        this.threadId =
        this.monoforumParentPeerId =
        this.canManageTopics = undefined;
      },
      findElement: (e) => {
        return findDialogListElement(e.target);
      }
    });
  }

  private getButtons() {
    if(this.buttons) {
      return this.buttons;
    }

    const [appSettings] = useAppSettings();
    this.buttons = [{
      icon: 'newtab',
      text: 'OpenInNewTab',
      onClick: (e: MouseEvent | TouchEvent) => {
        hotReloadGuard.appDialogsManager.openDialogInNewTab(this.li);
        if(this.options.recentSearch) {
          this.managers.appUsersManager.pushRecentSearch(this.peerId);
        }
        cancelEvent(e);
      },
      verify: () => IS_SHARED_WORKER_SUPPORTED && !this.monoforumParentPeerId
    }, {
      icon: 'eye',
      text: 'ChatList.Context.Preview',
      onClick: this.onPreviewClick,
      verify: () => !!this.dialog
    }, {
      icon: 'topics',
      text: 'TopicViewAsTopics',
      onClick: () => {
        hotReloadGuard.appImManager.toggleViewAsMessages(this.peerId, false);
      },
      // the flag outlives the forum it was set for, so ask the peer too
      verify: () => apiManagerProxy.isForum(this.peerId) &&
        !!(this.dialog && (this.dialog as Dialog).pFlags.view_forum_as_messages)
    }, {
      icon: 'topics',
      text: 'SavedViewAsChats',
      onClick: () => {
        hotReloadGuard.appImManager.toggleViewAsMessages(this.peerId, false);
      },
      verify: () => this.peerId === rootScope.myId && !appSettings.savedAsForum && !this.threadId
    }, {
      icon: 'message',
      text: 'SavedViewAsMessages',
      onClick: () => {
        hotReloadGuard.appImManager.toggleViewAsMessages(this.peerId, true);
      },
      verify: () => this.peerId === rootScope.myId && appSettings.savedAsForum && !this.threadId
    }, {
      icon: 'select',
      text: 'Message.Context.Select',
      onClick: () => {
        hotReloadGuard.appDialogsManager.getSelectionForRow(this.li)?.toggleByElement(this.li);
      },
      verify: () => !!hotReloadGuard.appDialogsManager.getSelectionForRow(this.li)?.canSelect(this.li)
    }, {
      icon: 'unread',
      text: 'MarkAsUnread',
      onClick: this.onUnreadClick,
      verify: async() => !!this.dialog &&
        !this.threadId &&
        // * a forum shown as topics is read, never marked unread (as tdesktop's Thread::canToggleUnread)
        !(apiManagerProxy.isForum(this.peerId) && !(this.dialog as Dialog).pFlags.view_forum_as_messages) &&
        !(await this.managers.appMessagesManager.isDialogUnread(this.dialog))
    }, {
      icon: 'readchats',
      text: 'MarkAsRead',
      onClick: this.onUnreadClick,
      verify: () => !!this.dialog && this.managers.appMessagesManager.isDialogUnread(this.dialog)
    }, createSubmenuTrigger({
      options: {
        icon: 'folder',
        text: 'AddToFolder',
        onClose: () => {
          this.addToFolderMenu?.controls.closeTooltip?.();
        },
        verify: () => isDialog(this.dialog) && this.hasFilters()
      },
      createSubmenu: this.createAddToFolderSubmenu
    }), {
      icon: 'pin',
      text: 'ChatList.Context.Pin',
      onClick: this.onPinClick,
      verify: async() => {
        if(!this.dialog) return false;
        if(isMonoforumDialog(this.dialog)) return false;

        if(isSavedDialog(this.dialog)) {
          return !this.dialog.pFlags.pinned;
        }

        if(this.threadId && !this.canManageTopics) {
          return false;
        }

        const isPinned = this.filterId !== undefined && this.filterId > 1 ?
          (await this.managers.appMessagesManager.getFilter(this.filterId)).pinnedPeerIds.includes(this.dialog.peerId) :
          !!this.dialog.pFlags?.pinned;
        return !isPinned;
      }
    }, {
      icon: 'unpin',
      text: 'ChatList.Context.Unpin',
      onClick: this.onPinClick,
      verify: async() => {
        if(!this.dialog) return false;
        if(isMonoforumDialog(this.dialog)) return false;

        if(isSavedDialog(this.dialog)) {
          return !!this.dialog.pFlags.pinned;
        }

        if(this.threadId && !this.canManageTopics) {
          return false;
        }

        const isPinned = this.filterId !== undefined && this.filterId > 1 ?
          (await this.managers.appMessagesManager.getFilter(this.filterId)).pinnedPeerIds.includes(this.dialog.peerId) :
          !!this.dialog.pFlags?.pinned;
        return isPinned;
      }
    }, {
      icon: 'mute',
      text: 'ChatList.Context.Mute',
      onClick: this.onMuteClick,
      verify: async() => {
        const managers = bindManagersToSession(this.managers);
        return !!this.dialog &&
          !this.monoforumParentPeerId &&
          this.peerId !== rootScope.myId &&
          !(await managers.appNotificationsManager.isPeerLocalMuted({
            peerId: this.peerId,
            threadId: this.threadId
          }));
      }
    }, {
      icon: 'unmute',
      text: 'ChatList.Context.Unmute',
      onClick: this.onUnmuteClick,
      verify: () => {
        return !!this.dialog &&
          !this.monoforumParentPeerId &&
          this.peerId !== rootScope.myId &&
          this.managers.appNotificationsManager.isPeerLocalMuted({
            peerId: this.peerId,
            threadId: this.threadId
          });
      }
    }, {
      icon: 'archive',
      text: 'Archive',
      onClick: this.onArchiveClick,
      verify: () => isDialog(this.dialog) &&
        !this.threadId &&
        !this.monoforumParentPeerId &&
        this.dialog.folder_id !== FOLDER_ID_ARCHIVE &&
        this.peerId !== rootScope.myId
    }, {
      icon: 'unarchive',
      text: 'Unarchive',
      onClick: this.onArchiveClick,
      verify: () => isDialog(this.dialog) &&
        !this.threadId &&
        !this.monoforumParentPeerId &&
        this.dialog.folder_id === FOLDER_ID_ARCHIVE &&
        this.peerId !== rootScope.myId
    }, CAN_HIDE_TOPIC ? {
      icon: 'hide',
      text: 'Hide',
      onClick: this.onHideTopicClick,
      verify: () => {
        return this.canManageTopics && (this.dialog as ForumTopic.forumTopic).id === GENERAL_TOPIC_ID;
      }
    } : undefined, {
      icon: 'lock',
      text: 'CloseTopic',
      onClick: this.onToggleTopicClick,
      verify: () => {
        return !apiManagerProxy.isBotforum(this.peerId) && this.canManageTopics && !(this.dialog as ForumTopic.forumTopic).pFlags.closed;
      }
    }, {
      icon: 'lockoff',
      text: 'RestartTopic',
      onClick: this.onToggleTopicClick,
      verify: () => {
        return this.canManageTopics && !!(this.dialog as ForumTopic.forumTopic).pFlags.closed;
      }
    }, {
      icon: 'lock',
      text: 'BlockUser',
      onClick: () => blockUserWithConfirmation({peerId: this.peerId}),
      verify: () => this.verifyBlock(false)
    }, {
      icon: 'lockoff',
      text: 'Unblock',
      onClick: () => unblockUser(this.peerId),
      verify: () => this.verifyBlock(true)
    }, {
      icon: 'crossround',
      text: 'DeleteFromRecent',
      onClick: () => this.managers.appUsersManager.removeRecentSearch(this.peerId),
      verify: () => !!this.options.recentSearch
    }, {
      icon: 'delete',
      className: 'danger',
      text: 'Delete',
      onClick: this.onDeleteClick,
      verify: () => this.canDelete
    }].filter(Boolean) as ButtonMenuItemOptionsVerifiable[];

    return this.buttons;
  }

  private createAddToFolderSubmenu = async({middleware}: CreateSubmenuArgs) => {
    if(!isDialog(this.dialog)) return;

    const {default: AddToFolderDropdownMenu, fetchDialogFilters} = await import('./addToFolderDropdownMenu');

    const filters = await fetchDialogFilters();

    if(!middleware()) return;

    const menu = new AddToFolderDropdownMenu;
    menu.feedProps({
      dialog: this.dialog,
      filters,
      currentFilter: () => hotReloadGuard.appDialogsManager.filterId,
      onNewDialog: (dialog) => {
        this.dialog = dialog;
      },
      onCleanup: () => {
        this.addToFolderMenu = undefined;
      }
    });

    return this.addToFolderMenu = menu;
  };

  public hasAddToFolderOpen = () => !!this.addToFolderMenu;

  private hasFilters = memoizeAsyncWithTTL(async() => {
    const filters = await this.managers.filtersStorage.getDialogFilters();
    return !!filters.filter(filter => !REAL_FOLDERS.has(filter.id)).length
  }, () => 1, 5_000);


  private async checkIfCanDelete() {
    if(!this.dialog) {
      return false;
    }

    const chat = await this.managers.appChatsManager.getChat(this.peerId.toChatId());
    if(chat?._ === 'channel' && chat?.pFlags?.monoforum && (chat?.pFlags?.left || chat?.pFlags?.creator)) return false;

    if(this.threadId) {
      if(isSavedDialog(this.dialog)) {
        return true;
      }

      if(!this.canManageTopics) {
        return false;
      }

      return (this.dialog as ForumTopic.forumTopic).id !== GENERAL_TOPIC_ID;
    }

    return true;
  }

  private onArchiveClick = async() => {
    const managers = bindManagersToSession(this.managers);
    const dialog = await managers.appMessagesManager.getDialogOnly(this.peerId);
    if(dialog) {
      managers.appMessagesManager.editPeerFolders([dialog.peerId], +!dialog.folder_id as REAL_FOLDER_ID);
    }
  };

  private onHideTopicClick = () => {
    this.managers.appMessagesManager.editForumTopic({
      peerId: this.peerId,
      topicId: this.threadId,
      hidden: true
    });
  };

  private onToggleTopicClick = () => {
    this.managers.appMessagesManager.editForumTopic({
      peerId: this.peerId,
      topicId: this.threadId,
      closed: !(this.dialog as ForumTopic.forumTopic).pFlags.closed
    });
  };

  private onPinClick = () => {
    const {peerId, filterId, threadId, dialog} = this;
    const isSaved = isSavedDialog(dialog);
    this.managers.appMessagesManager.toggleDialogPin({
      peerId,
      filterId,
      topicOrSavedId: threadId
    }).catch((err: ApiError) => {
      showPinLimitReached(err, {filterId, isSaved, isTopic: !!threadId});
    });
  };

  private onUnmuteClick = () => {
    this.managers.appMessagesManager.togglePeerMute({peerId: this.peerId, mute: false, threadId: this.threadId});
  };

  private onMuteClick = () => {
    showMutePopup(this.peerId, this.threadId);
  };

  private onPreviewClick = () => {
    showChatPreviewPopup({
      peerId: this.monoforumParentPeerId || this.peerId,
      monoforumThreadId: this.monoforumParentPeerId ? this.peerId : undefined,
      threadId: this.threadId,
      lastMsgId: +this.li.dataset.mid || undefined,
      anchor: chatPreviewAnchorFromDialogRow(this.li)
    });
  };

  private onUnreadClick = async() => {
    const managers = bindManagersToSession(this.managers);
    const {peerId, dialog} = this;
    if(!isDialog(dialog) && !isForumTopic(dialog) && !isMonoforumDialog(dialog)) return;

    if(this.monoforumParentPeerId) {
      managers.appMessagesManager.markDialogUnread({
        peerId: this.monoforumParentPeerId,
        monoforumThreadId: this.peerId,
        read: !!dialog.unread_count
      });
    } else if(dialog.unread_count) {
      if(!this.threadId) {
        managers.appMessagesManager.markDialogUnread({peerId, read: true});
      } else {
        managers.appMessagesManager.readHistory({peerId, maxId: dialog.top_message, threadId: this.threadId});
      }
    } else if(!this.threadId) {
      managers.appMessagesManager.markDialogUnread({peerId});
    }
  };

  /**
   * tdesktop's chat list blocks someone who is not a contact from their row, and unblocks them there. Whether one
   * is blocked is known from their full profile, a block update or the blocked list: one not known yet reads as not
   * blocked, as in tdesktop (the menu waits for no request), and the manager looks them up for the next opening.
   */
  private verifyBlock = async(blocked: boolean) => {
    const {peerId} = this;
    if(
      !isDialog(this.dialog) ||
      this.threadId ||
      !peerId.isUser() ||
      peerId === rootScope.myId ||
      peerId === REPLIES_PEER_ID ||
      peerId === VERIFICATION_CODES_BOT_ID.toPeerId()
    ) {
      return false;
    }

    const user = apiManagerProxy.getUser(peerId.toUserId());
    if(!user || user.pFlags.contact || user.pFlags.deleted) {
      return false;
    }

    return await this.managers.appProfileManager.isUserKnownBlocked(peerId.toUserId()) === blocked;
  };

  private onDeleteClick = () => {
    showDeleteDialogPopup(
      this.peerId,
      undefined,
      undefined,
      this.threadId,
      this.monoforumParentPeerId
    );
  };
}
