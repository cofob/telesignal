import {ChatInviteImporter, ExportedChatInvite} from '@layer';
import {AppManagers} from '@lib/managers';
import AppSelectPeers from '@components/appSelectPeers';

export type ChatInvite = ExportedChatInvite.chatInviteExported;

export function getImportersLoader({
  chatId,
  managers,
  link,
  requested,
  onCount
}: {
  chatId: ChatId,
  managers: AppManagers,
  link?: string,
  requested?: boolean,
  /** the server's total, from each page loaded without a search query */
  onCount?: (count: number) => void
}) {
  const importers: ChatInviteImporter[] = [];
  const importersMap: Map<PeerId, ChatInviteImporter> = new Map();
  let lastQuery = '';
  // * what changes while a page is on its way puts it behind: one request answered, the server's count in
  // * it; all of them answered at once (`reset`) or another query, the whole page
  let revision = 0, resetRevision = 0;
  const reset = () => {
    resetRevision = ++revision;
    importers.length = 0;
    importersMap.clear();
  };

  const load: AppSelectPeers['getMoreCustom'] = async(q) => {
    if(lastQuery !== q) {
      reset();
      lastQuery = q;
    }

    const limit = 50;
    const lastImporter = importers[importers.length - 1];
    const startRevision = revision;
    const result = await managers.appChatInvitesManager.getChatInviteImporters({
      chatId,
      limit,
      link,
      requested,
      offsetDate: lastImporter?.date,
      offsetUserId: lastImporter?.user_id,
      q
    });

    if(resetRevision > startRevision) {
      // * not the end: the next page is asked for anew, from the start
      return {result: [], isEnd: false};
    }

    importers.push(...result.importers);
    if(!q && revision === startRevision) {
      onCount?.(result.count);
    }

    return {
      result: result.importers.map((importer) => {
        const peerId = importer.user_id.toPeerId(false);
        importersMap.set(peerId, importer);
        return peerId;
      }),
      isEnd: result.importers.length < limit
    };
  };

  const deleteImporter = (peerId: PeerId) => {
    ++revision;
    const index = importers.findIndex((importer) => importer.user_id.toPeerId(false) === peerId);
    if(index !== -1) {
      importers.splice(index, 1);
    }

    importersMap.delete(peerId);
  };

  return {
    importers,
    importersMap,
    load,
    deleteImporter,
    reset
  };
}
