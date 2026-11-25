import {batch, createMemo, createRoot, onCleanup} from 'solid-js';
import namedPromises from '@helpers/namedPromises';
import reorderIndexes from '@helpers/array/reorderIndexes';
import pickKeys from '@helpers/object/pickKeys';
import safeAssign from '@helpers/object/safeAssign';
import {default as appDialogsManager} from '@lib/appDialogsManager';
import {DialogElement} from '@components/dialogElement';
import {ReadingManagers} from '@lib/managers';
import getDialogIndexKey from '@appManagers/utils/dialogs/getDialogIndexKey';
import {logger} from '@lib/logger';
import {createDeferredSortedVirtualList, DeferredSortedVirtualListItem} from '@components/deferredSortedVirtualList';
import {LoadingDialogSkeletonSize} from '@components/loadingDialogSkeleton';
import Scrollable from '@components/scrollable';
import useElementSize from '@hooks/useElementSize';
import {DIALOG_WITH_FOLDER_TAGS_HEIGHT, DialogFolderTagsContext} from '@components/folderTags/dialogFolderTags';
import {bindManagersToSession} from '@lib/accounts/bindManagersToAccount';

export default class SortedDialogList {
  private appDialogsManager: typeof appDialogsManager;
  public managers: ReadingManagers;
  public log: ReturnType<typeof logger>;
  public list: HTMLElement;
  public indexKey: ReturnType<typeof getDialogIndexKey>;
  public onListLengthChange: () => void;
  /** The peer whose sublists the list has: Saved Messages */
  public virtualFilterId: PeerId;

  /**
   * Whether this is the chat list of a folder (any folder - All, a custom one, the archive), as
   * opposed to the saved dialogs. Not `indexKey === 'index_0'`: that is All alone
   */
  public get isMainList() {
    return !this.virtualFilterId;
  }

  private virtualList: ReturnType<typeof createDeferredSortedVirtualList<SortedDialogListItem>>;
  /** what the rows get for their folder tags, in a folder's chat list */
  private folderTags: DialogFolderTagsContext;
  private disposeFolderTags: () => void;
  private totalCount = 0;

  /**
   * The custom emoji from the last message gets destroyed completely when removing the dialog
   * element from the DOM, with no easy way of re-initializing them, so we need to forcefully
   * re-initialize the last message
   */
  private unmountedDialogElements = new WeakMap<DialogElement, boolean>;

  constructor(options: {
    appDialogsManager: SortedDialogList['appDialogsManager'],
    managers: SortedDialogList['managers'],
    log?: SortedDialogList['log'],
    indexKey: SortedDialogList['indexKey'],
    onListLengthChange?: SortedDialogList['onListLengthChange'],
    virtualFilterId?: SortedDialogList['virtualFilterId'],

    scrollable: Scrollable,
    requestItemForIdx: (idx: number, itemsLength: number) => void,
    onListShrinked: () => void,
    itemSize: LoadingDialogSkeletonSize,
    noAvatar?: boolean // For the loading skeleton placeholder,
    extraPaddingBottom?: number,
    // the folder whose chat list this is: its rows wear the tags of the other folders
    folderTagsFilterId?: number
  }) {
    safeAssign(this, pickKeys(options, [
      'appDialogsManager',
      'managers',
      'log',
      'indexKey',
      'virtualFilterId',
      'onListLengthChange'
    ]));

    this.virtualList = createDeferredSortedVirtualList({
      scrollable: options.scrollable.container,
      getItemElement: (item, key) => {
        if(item.type === 'custom-pinned-dialog') {
          return item.value.render();
        }

        const dialogElement = item.value;

        if(this.unmountedDialogElements.get(dialogElement)) {
          const {options} = this.getDialogOptions(key);

          /**
           * Re-initing the dialog is pretty expensive on performance,
           * so we wait a little bit before it, in case the user scrolls
           * like crazy up and down
           */
          const timeout = self.setTimeout(() => {
            this.appDialogsManager.initDialog(dialogElement, options)
            .then(
              () => {
                this.unmountedDialogElements.delete(dialogElement);
              },
              () => {}
            );
          }, 200);

          onCleanup(() => {
            self.clearTimeout(timeout);
          });
        }

        return dialogElement.dom.listEl;
      },
      // * A dropped DialogElement owns a middlewareHelper (getDialogOptions passes controlled: true),
      // * and everything wrapped under it - the emoji status renderer, its lottie/video players, the
      // * subtitle's custom emoji - is released only by that helper's destroy. The list used to drop
      // * elements without it (removeItem, checkShrink's trimmed tail, clear, dispose), so every
      // * trimmed row leaked its renderer, and the compositor worker kept its OffscreenCanvas forever.
      // * Only 'dialog' items are ours to destroy: the custom ones are the caller's own objects,
      // * handed in as the key, and may be re-added later.
      onItemDiscard: (item) => {
        if(item.type === 'dialog') {
          this.unmountedDialogElements.delete(item.value);
          item.value.destroy();
        }
      },
      // * a row comes into the list in the state the selection has it in: one built while rows are
      // * being selected (loaded as the list is scrolled) never had a checkbox, and one remounted
      // * may still carry the one it had when it went out of view, from a mode that has since ended
      onItemMount: (item, element) => {
        if(item.type === 'dialog') {
          this.appDialogsManager.getSelectionForRow(element)?.applyToElement(element, false);
        }
      },
      onItemUnmount: (item) => {
        if(item.type === 'dialog') {
          this.unmountedDialogElements.set(item.value, true);
          // the nodes survive the unmount but their custom emoji do not, so the
          // re-init below must rebuild the subtitle rather than recognize it as
          // already rendered
          delete item.value.dom.lastMessageRenderKey;
        }
      },
      onListShrinked: options.onListShrinked,
      requestItemForIdx: options.requestItemForIdx,
      sortWith: (a, b) => b - a,
      itemSize: options.itemSize,
      // * a row with folder tags is a line taller
      getItemHeight: options.folderTagsFilterId !== undefined ? (item) => {
        return item.type === 'dialog' && item.value.folderTags?.hasTags() ?
          DIALOG_WITH_FOLDER_TAGS_HEIGHT :
          options.itemSize;
      } : undefined,
      noAvatar: options.noAvatar,
      onListLengthChange: options.onListLengthChange,
      extraPaddingBottom: options.extraPaddingBottom
    });

    this.list = this.virtualList.list;

    this.list.classList.add('chatlist', 'virtual-chatlist');

    if(options.folderTagsFilterId !== undefined) {
      createRoot((dispose) => {
        this.disposeFolderTags = dispose;
        // * every row is as wide as the list's content, so the one observer serves them all
        const listSize = useElementSize(() => this.list);
        const rowWidth = createMemo(() => {
          const width = listSize.width;
          if(!width) {
            return 0;
          }

          const style = getComputedStyle(this.list);
          return width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        });

        this.folderTags = {
          filterId: options.folderTagsFilterId,
          width: rowWidth
        };
      });
    }
  }


  public async getIndexForKey(key: any) {
    const managers = bindManagersToSession(this.managers);
    if(key instanceof CustomPinnedDialog) return 0;
    return managers.dialogsStorage.getDialogIndex(
      this.virtualFilterId ?? key,
      this.indexKey,
      this.virtualFilterId ? key : undefined
    )
  }

  public async createItemForKey(key: any) {
    const {index, value} = await namedPromises({
      index: this.getIndexForKey(key),
      value: this.createElementForKey(key)
    });

    return {id: key, index, value};
  }

  private getDialogOptions(key: any) {
    const loadPromises: Promise<any>[] = [];

    const options: Parameters<typeof appDialogsManager['addListDialog']>[0] = {
      peerId: this.virtualFilterId ?? key,
      loadPromises,
      isBatch: true,
      threadId: this.virtualFilterId ? key : undefined,
      isMainList: this.isMainList,
      controlled: true,
      meAsSaved: true,
      wrapOptions: undefined,
      folderTags: this.folderTags
    };

    return {options, loadPromises};
  }

  public async createElementForKey(key: any): Promise<SortedDialogListItem> {
    if(key instanceof CustomPinnedDialog) return {
      type: 'custom-pinned-dialog',
      value: key
    };

    const {options, loadPromises} = this.getDialogOptions(key);

    const autoDeletePeriod = await this.getDialogAutoDeletePeriod(key);
    options.autoDeletePeriod = autoDeletePeriod;

    const dialogElement = this.appDialogsManager.addListDialog(options);

    await Promise.all(loadPromises);

    return {
      type: 'dialog',
      value: dialogElement
    };
  }

  private async getDialogAutoDeletePeriod(key: any) {
    if(
      key instanceof CustomPinnedDialog ||
      !this.isMainList
    ) return;

    const dialog = await this.managers.dialogsStorage.getDialogOnly(key);
    if(!dialog) return;

    return dialog.ttl_period || undefined;
  }

  public addDeferredItems(items: DeferredSortedVirtualListItem<SortedDialogListItem>[], totalCount: number) {
    batch(() => {
      this.totalCount = totalCount;
      this.virtualList.setWasAtLeastOnceFetched(true);
      this.virtualList.addItems(items);
      this.updateTotalCount();
    });
  }

  public async add(key: any, canFinish: () => boolean = () => true) {
    const item = await this.createItemForKey(key);
    if(!canFinish()) {
      return;
    }

    this.virtualList.addItems([item]);
    // this.virtualList.setTotalCount(prev => prev + 1);
  }

  public async addPinned(key: any) {
    const item = await this.createItemForKey(key);
    this.virtualList.addPinnedItems([item]);
  }

  public async ensurePinned(key: any) {
    const item = await this.createItemForKey(key);
    this.virtualList.ensurePinnedItems([item]);
  }

  public removePinned(key: any) {
    this.virtualList.removePinnedItem(key);
  }

  public blockAnimation() {
    return this.virtualList.blockAnimation();
  }

  public delete(key: any, adjustTotalCount = true) {
    batch(() => {
      // * Pinned entries live in their own collection, but every read API merges both - has(),
      // * getDialogElement() and getAllDialogElementsMap() all see them - so callers routinely
      // * discover a pinned key and delete it through here (validateListForFilter walks the merged
      // * map; updateDialog gates on has()). Removing only from the unpinned side left the row on
      // * screen, took the total count down for a row that never went away, and never reached
      // * onItemDiscard, so the DialogElement kept its middlewareHelper - and everything under it -
      // * until the tab was closed. Both sides, so delete means delete.
      const removedPinned = this.virtualList.removePinnedItem(key);
      const removedItem = this.virtualList.removeItem(key);
      if((removedPinned || removedItem) && adjustTotalCount) {
        this.adjustTotalCount(-1);
      }
    });
  }

  private adjustTotalCount(delta: number) {
    this.totalCount = Math.max(0, this.totalCount + delta);
    this.updateTotalCount();
  }

  private updateTotalCount() {
    this.virtualList.setTotalCount(this.totalCount);
  }

  public has(key: any) {
    return this.virtualList.has(key);
  }

  public getDialogElement(key: any) {
    const item = this.virtualList.get(key);
    if(item?.type === 'dialog') return item.value;
  }

  public getAllDialogElementsMap() {
    const map = this.virtualList.getAll();

    const filteredEntries = Array.from(map.entries())
    .map(([key, value]) => value?.type === 'dialog' ? [key, value.value] as [any, DialogElement] : null)
    .filter(Boolean);

    return new Map(filteredEntries);
  }

  public getSortedItems() {
    return this.virtualList.sortedItems();
  }

  /**
   * Reorders rows the list already holds by handing them each other's indexes, without asking the
   * managers for fresh ones - so a reorder the user just performed by hand is on screen in the same
   * task, before any round trip. The managers regenerate the very same order right after (see
   * `appMessagesManager.reorderPinnedDialogs`), so this is the optimistic half of one reorder, not
   * a second source of truth.
   *
   * @param keys the keys to reorder, in the order they have to end up in
   * @returns whether every key was in the list, i.e. whether the new order was applied
   */
  public reorderItems(keys: any[]) {
    // the list puts the greatest index first, so the indexes come back top to bottom
    const indexes = reorderIndexes(this.getSortedItems(), keys, true);
    if(!indexes) {
      return false;
    }

    batch(() => {
      keys.forEach((key, idx) => this.virtualList.updateItem(key, indexes[idx]));
    });

    return true;
  }

  public async update(key: any, canFinish: () => boolean = () => true) {
    const index = await this.getIndexForKey(key);
    if(!canFinish()) {
      return;
    }

    this.virtualList.updateItem(key, index);
  }

  public itemsLength() {
    return this.virtualList.itemsLength();
  }

  public clear() {
    this.totalCount = 0;
    this.virtualList?.clear();
  }

  public destroy() {
    this.virtualList?.dispose();
    this.disposeFolderTags?.();
  }
}

interface CustomPinnedDialogCtorArgs {
  render: () => HTMLElement;
};

export class CustomPinnedDialog {
  render: () => HTMLElement;

  constructor({render}: CustomPinnedDialogCtorArgs) {
    this.render = render;
  }
}

type SortedDialogListItem = {
  type: 'custom-pinned-dialog',
  value: CustomPinnedDialog;
} | {
  type: 'dialog',
  value: DialogElement;
}
