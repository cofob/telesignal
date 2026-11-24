import type { TeactNode } from '../../lib/teact/teact';
import {
  memo, useCallback, useEffect, useMemo, useState,
} from '../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../global';

import type { ApiChatFolder, ApiChatType } from '../../api/types';
import type { GlobalState } from '../../global/types';

import { ALL_FOLDER_ID, API_CHAT_TYPES } from '../../config';
import { getCanPostInChat, isDeletedUser } from '../../global/helpers';
import { filterPeersByQuery } from '../../global/helpers/peers';
import {
  filterChatIdsByType, selectCanInviteToChat, selectChat, selectChatFullInfo, selectUser,
} from '../../global/selectors';
import { unique } from '../../util/iteratees';
import sortChatIds from './helpers/sortChatIds';

import useCurrentOrPrev from '../../hooks/useCurrentOrPrev';
import { useFolderManagerForOrderedIds } from '../../hooks/useFolderManager';
import useFolderTabs from '../../hooks/useFolderTabs';
import useLastCallback from '../../hooks/useLastCallback';

import Island from '../gili/layout/Island';
import TabList from '../ui/TabList';
import ListTopPeers from './ListTopPeers';
import ChatOrUserPicker, { type SearchRowRenderProps } from './pickers/ChatOrUserPicker';
import PickerSearchField, { type PickerSearchChip } from './pickers/PickerSearchField';

import styles from './RecipientPicker.module.scss';

export type OwnProps = {
  isOpen: boolean;
  title?: string;
  searchPlaceholder: string;
  className?: string;
  filter?: readonly ApiChatType[];
  isLowStackPriority?: boolean;
  isNativeDialog?: boolean;
  shouldFilterInviteable?: boolean;
  isMultiSelect?: boolean;
  // How many recipients a multiple selection takes; a further one calls `onMaxSelected` instead
  maxSelectedCount?: number;
  withFolders?: boolean;
  footer?: TeactNode;
  viewportFooter?: TeactNode;
  loadMore?: NoneToVoidFunction;
  onSelectRecipient: (peerId: string) => void;
  onSelectedIdsChange?: (ids: string[]) => void;
  onMaxSelected?: NoneToVoidFunction;
  onClose: NoneToVoidFunction;
  onCloseAnimationEnd?: NoneToVoidFunction;
};

type StateProps = {
  currentUserId?: string;
  activeListIds?: string[];
  archivedListIds?: string[];
  pinnedIds?: string[];
  contactIds?: string[];
  topPeerIds?: string[];
  chatFoldersById: Record<number, ApiChatFolder>;
  orderedFolderIds?: number[];
};

const RECENT_CONTACTS_LIMIT = 15;

const RecipientPicker = ({
  isOpen,
  currentUserId,
  activeListIds,
  archivedListIds,
  pinnedIds,
  contactIds,
  topPeerIds,
  filter = API_CHAT_TYPES,
  title,
  className,
  searchPlaceholder,
  isLowStackPriority,
  isNativeDialog,
  chatFoldersById,
  orderedFolderIds,
  shouldFilterInviteable,
  isMultiSelect,
  maxSelectedCount,
  withFolders,
  footer,
  viewportFooter,
  loadMore,
  onSelectRecipient,
  onSelectedIdsChange,
  onMaxSelected,
  onClose,
  onCloseAnimationEnd,
}: OwnProps & StateProps) => {
  const { openLimitReachedModal, loadTopPeers } = getActions();

  useEffect(() => {
    if (isOpen) {
      loadTopPeers({ category: 'correspondents' });
    }
  }, [isOpen, loadTopPeers]);

  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [activeFolderIndex, setActiveFolderIndex] = useState(0);
  const { displayedFolders, folderTabs } = useFolderTabs({
    sidebarMode: false,
    orderedFolderIds,
    chatFoldersById,
    noEmoticons: true,
    isReadOnly: true,
  });

  const shouldRenderFolders = withFolders && folderTabs && folderTabs.length > 1 && !search;
  const displayedFolderId = displayedFolders?.[activeFolderIndex]?.id || ALL_FOLDER_ID;
  const orderedChatIds = useFolderManagerForOrderedIds(displayedFolderId);

  const handleSwitchFolderIndex = useLastCallback((index: number) => {
    const newTab = folderTabs?.[index];
    if (!newTab) return;

    if (newTab.isBlocked) {
      openLimitReachedModal({
        limit: 'dialogFilters',
      });
      return;
    }

    setActiveFolderIndex(index);
  });

  const updateSelectedIds = useLastCallback((newIds: string[]) => {
    setSelectedIds(newIds);
    onSelectedIdsChange?.(newIds);
  });

  const handleRemoveSelected = useLastCallback((peerId: string) => {
    updateSelectedIds(selectedIds.filter((id) => id !== peerId));
  });

  const handleToggleSelection = useLastCallback((peerId: string) => {
    if (selectedIds.includes(peerId)) {
      handleRemoveSelected(peerId);
    } else if (maxSelectedCount && selectedIds.length >= maxSelectedCount) {
      onMaxSelected?.();
    } else {
      updateSelectedIds([...selectedIds, peerId]);
    }
  });

  const handleSelect = useLastCallback((peerId: string) => {
    if (isMultiSelect) {
      handleToggleSelection(peerId);
    } else {
      onSelectRecipient(peerId);
    }
  });

  const ids = useMemo(() => {
    if (!isOpen) return [];

    let priorityIds = pinnedIds || [];
    if (currentUserId) {
      priorityIds = unique([currentUserId, ...priorityIds]);
    }

    // No need for expensive global updates on users, so we avoid them
    const global = getGlobal();

    const allIds = shouldRenderFolders ? (orderedChatIds || []) : [
      ...(activeListIds || []),
      ...((search && archivedListIds) || []),
    ];

    const peerIds = allIds.filter((id) => getIsRecipientAllowed(global, id, shouldFilterInviteable));

    const idsWithAdditions = shouldRenderFolders ? peerIds : unique([
      ...(currentUserId ? [currentUserId] : []),
      ...peerIds,
      ...(contactIds || []),
    ]);

    const sorted = sortChatIds(
      filterPeersByQuery({
        ids: idsWithAdditions,
        query: search,
      }),
      priorityIds,
      currentUserId,
    );

    return filterChatIdsByType(global, sorted, filter);
  }, [
    isOpen,
    pinnedIds,
    currentUserId,
    activeListIds,
    search,
    archivedListIds,
    contactIds,
    filter,
    shouldFilterInviteable,
    orderedChatIds,
    shouldRenderFolders,
  ]);

  const renderingIds = useCurrentOrPrev(ids, true);

  const recentContactIds = useMemo(() => {
    const global = getGlobal();
    const source = topPeerIds?.length ? topPeerIds : (contactIds || []);
    const allowed = source.filter((id) => getIsRecipientAllowed(global, id, shouldFilterInviteable));
    return filterChatIdsByType(global, allowed, filter).slice(0, RECENT_CONTACTS_LIMIT);
  }, [topPeerIds, contactIds, filter, shouldFilterInviteable]);

  const hasSelectedChips = isMultiSelect && selectedIds.length > 0;

  const searchChips = useMemo(() => {
    if (!hasSelectedChips) return undefined;
    return selectedIds.map((peerId): PickerSearchChip => ({
      key: peerId,
      peerId,
      canClose: true,
    }));
  }, [hasSelectedChips, selectedIds]);

  const renderSearchRow = useCallback((props: SearchRowRenderProps) => {
    return (
      <PickerSearchField
        inputRef={props.inputRef}
        value={props.value}
        placeholder={props.placeholder}
        chips={searchChips}
        onChange={props.onChange}
        onKeyDown={props.onKeyDown}
        onChipClick={handleRemoveSelected}
      />
    );
  }, [searchChips]);

  const subheaderContent = useMemo(() => {
    const hasRecentContacts = recentContactIds.length > 0 && !search;
    const hasFolderTabs = shouldRenderFolders;

    if (!hasRecentContacts && !hasFolderTabs) return undefined;

    return (
      <>
        {hasRecentContacts && (
          <Island className={styles.recentContacts}>
            <ListTopPeers
              peerIds={recentContactIds}
              currentUserId={currentUserId}
              selectedIds={isMultiSelect ? selectedIds : undefined}
              onPeerClick={handleSelect}
            />
          </Island>
        )}
        {Boolean(hasFolderTabs) && folderTabs && (
          <TabList
            tabs={folderTabs}
            activeTab={activeFolderIndex}
            onSwitchTab={handleSwitchFolderIndex}
          />
        )}
      </>
    );
  }, [
    recentContactIds,
    search,
    shouldRenderFolders,
    currentUserId,
    handleSelect,
    isMultiSelect,
    selectedIds,
    folderTabs,
    activeFolderIndex,
    handleSwitchFolderIndex,
  ]);

  return (
    <ChatOrUserPicker
      isOpen={isOpen}
      className={className}
      chatOrUserIds={renderingIds}
      currentUserId={currentUserId}
      title={title}
      searchPlaceholder={searchPlaceholder}
      search={search}
      renderSearchRow={renderSearchRow}
      subheader={subheaderContent}
      footer={footer}
      viewportFooter={viewportFooter}
      listActiveKey={activeFolderIndex}
      selectedIds={isMultiSelect ? selectedIds : undefined}
      onSearchChange={setSearch}
      loadMore={loadMore}
      onSelectChatOrUser={handleSelect}
      onClose={onClose}
      onCloseAnimationEnd={onCloseAnimationEnd}
      isLowStackPriority={isLowStackPriority}
      isNativeDialog={isNativeDialog}
    />
  );
};

function getIsRecipientAllowed(
  global: GlobalState,
  id: string,
  shouldFilterInviteable?: boolean,
) {
  const chat = selectChat(global, id);
  const user = selectUser(global, id);
  if (user) return !isDeletedUser(user);

  if (!chat) return false;

  if (shouldFilterInviteable) {
    return selectCanInviteToChat(global, id);
  }

  const chatFullInfo = selectChatFullInfo(global, id);
  // TODO: Handle bulk check with API call
  return !chatFullInfo || getCanPostInChat(chat);
}

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => {
    const {
      chatFolders: {
        byId: chatFoldersById,
        orderedIds: orderedFolderIds,
      },
      chats: {
        listIds,
        orderedPinnedIds,
      },
      currentUserId,
    } = global;

    return {
      activeListIds: listIds.active,
      archivedListIds: listIds.archived,
      pinnedIds: orderedPinnedIds.active,
      contactIds: global.contactList?.userIds,
      topPeerIds: global.topPeerCategories.correspondents?.peerIds,
      currentUserId,
      chatFoldersById,
      orderedFolderIds,
    };
  },
)(RecipientPicker));
