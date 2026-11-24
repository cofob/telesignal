/*
 * TeleSignal: the page's side of Signal stories: the distribution lists and sending a story, which the story composer
 * and the stories settings call on the engine in the worker (`appSignalManager`), as Web A's
 * `SettingsStories` and `StoryComposerModal` do.
 */

import type {SignalChats} from '@lib/signal/signalApi';
import type {SignalStoryDistributionList, SignalTextStoryStyle} from '@lib/signal/storiesApi';
import rootScope from '@lib/rootScope';
import {callSignalApi} from '@lib/signal/settingsApi';

/** A story to send: text on one of the preset backgrounds, or a photo or video with a caption */
export type SignalNewStory = {
  text?: string,
  textStyle?: SignalTextStoryStyle,
  backgroundIndex?: number,
  file?: File,
  width?: number,
  height?: number,
  caption?: string
};

/** A group a story can be sent to, by the provider's id */
export type SignalStoryGroup = {id: string, title: string};

// * the chats a story can go to are those of the chat list, as Web A's composer lists them
const CHATS_LIMIT = 1000;

export function fetchStoryDistributionLists(): Promise<SignalStoryDistributionList[] | undefined> {
  return callSignalApi('fetchStoryDistributionLists');
}

/** Creates a list (without `id`) or changes one; resolves with the list saved */
export function saveStoryDistributionList(
  list: Omit<SignalStoryDistributionList, 'id'> & {id?: string}
): Promise<SignalStoryDistributionList | undefined> {
  return callSignalApi('saveStoryDistributionList', {list});
}

export function deleteStoryDistributionList(id: string): Promise<true | undefined> {
  return callSignalApi('deleteStoryDistributionList', {id});
}

/** The groups of the chat list that we are still in */
export async function fetchStoryGroups(): Promise<SignalStoryGroup[]> {
  const result: SignalChats | undefined = await callSignalApi('fetchChats', {limit: CHATS_LIMIT, withPinned: true});
  return (result?.chats ?? [])
  .filter((chat) => chat.type === 'chatTypeBasicGroup' && !chat.isForbidden && !chat.isNotJoined)
  .map(({id, title}) => ({id, title}));
}

/** Sends a story to distribution lists and groups; resolves with `true` once it went out */
export function sendSignalStory(story: SignalNewStory, listIds: string[], groupIds: string[]): Promise<true | undefined> {
  return rootScope.managers.appSignalManager.sendSignalStory(story, listIds, groupIds);
}
