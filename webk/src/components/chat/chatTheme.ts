import {unwrap} from 'solid-js/store';
import {ChatFull, ChatTheme, Theme, UserFull, WallPaper, WallPaperSettings} from '@layer';
import {appState} from '@stores/appState';
import copy from '@helpers/object/copy';
import deepEqual from '@helpers/object/deepEqual';
import {cleanEmoji} from '@lib/richTextProcessor/fixEmoji';

/**
 * What tells chat themes apart: an emoticon, or '' for no theme. An emoticon is compared without its
 * variation selectors, as tdesktop finds it: the server names the theme it was given as `⛄` by `⛄️`
 * in the service message.
 */
export function getChatThemeKey(chatTheme: ChatTheme | undefined) {
  const emoticon = (chatTheme as ChatTheme.chatTheme)?.emoticon;
  return emoticon ? cleanEmoji(emoticon) : '';
}

export function getThemeByEmoticon(emoticon: string) {
  if(!emoticon) {
    return;
  }

  const key = cleanEmoji(emoticon);
  return unwrap(appState.accountThemes.themes?.find((theme) => theme.emoticon && cleanEmoji(theme.emoticon) === key));
}

export function getThemeFromChatTheme(chatTheme: ChatTheme | undefined): Theme | undefined {
  return getThemeByEmoticon((chatTheme as ChatTheme.chatTheme)?.emoticon);
}

// * one copy per wallpaper as it is set up: the background tells them apart by reference, and the
// * full peer store rewrites its own object in place when the same wallpaper comes with new settings
const wallPaperSnapshots: Map<string, WallPaper> = new Map();

/**
 * The chat's wallpaper as the background takes it. An image dimmed by its intensity is drawn
 * differently by day and by night, so with `isNight` it is a new one for each side of the day.
 */
function getWallPaperSnapshot(wallPaper: WallPaper, isNight?: boolean) {
  // * read through the store, so whoever asks follows changes of the settings too
  const settings = JSON.stringify(wallPaper.settings ?? null);
  const isDimmedImage = wallPaper._ === 'wallPaper' && !wallPaper.pFlags?.pattern && !!wallPaper.settings?.intensity;
  const key = wallPaper.id + settings + (isDimmedImage && isNight !== undefined ? (isNight ? ':night' : ':day') : '');
  let snapshot = wallPaperSnapshots.get(key);
  if(!snapshot) {
    wallPaperSnapshots.set(key, snapshot = copy(unwrap(wallPaper)));
  }

  return snapshot;
}

const NO_SETTINGS: WallPaperSettings = {_: 'wallPaperSettings', pFlags: {}};

/** The same wallpaper set up the same way, as tdesktop's `WallPaper::equals` tells them apart. */
export function isSameWallPaper(a: WallPaper, b: WallPaper) {
  return a._ === b._ &&
    String(a.id) === String(b.id) &&
    deepEqual(a.settings ?? NO_SETTINGS, b.settings ?? NO_SETTINGS, ['flags']);
}

/**
 * The background a chat shows for its full peer, as tdesktop draws it: a theme (by emoticon) gives
 * the colours and its own wallpaper, and a wallpaper set for the chat stands in for
 * that wallpaper. A wallpaper that only names a theme by its emoticon is that theme.
 */
export function getChatBackgroundFromFullPeer(
  fullPeer: UserFull | ChatFull | undefined,
  isNight?: boolean
): {theme?: Theme, wallPaper?: WallPaper} {
  if(!fullPeer) {
    return {};
  }

  const storeWallPaper = (fullPeer as ChatFull.channelFull).wallpaper;
  const wallPaper = storeWallPaper && getWallPaperSnapshot(storeWallPaper, isNight);
  const theme = getThemeFromChatTheme((fullPeer as UserFull.userFull).theme) ||
    getThemeByEmoticon((fullPeer as ChatFull.channelFull).theme_emoticon);
  const wallPaperTheme = getThemeByEmoticon(wallPaper?.settings?.emoticon);
  if(wallPaperTheme) {
    return {theme: theme || wallPaperTheme};
  }

  return {theme, wallPaper};
}
