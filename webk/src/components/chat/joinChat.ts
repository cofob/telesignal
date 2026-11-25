import {handleChannelsTooMuch} from '@components/popups/channelsTooMuch';
import {type AppImManager} from '@lib/appImManager';
import type {AppManagers} from '@lib/managers';
import rootScope from '@lib/rootScope';


export default async function joinChat(options: {
  peerId: PeerId,
  managers: AppManagers,
  appImManager?: AppImManager
}) {
  const {peerId, managers} = options;
  const chatId = peerId.toChatId();

  const isChannel = await managers.appChatsManager.isChannel(chatId);
  await handleChannelsTooMuch(() => {
    return isChannel ?
      managers.appChatsManager.joinChannel(chatId) :
      managers.appChatsManager.addChatUser(chatId, rootScope.myId);
  });
}
