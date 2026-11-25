import type {Reaction, ShareTheme, ShareThemeBackdropOption} from '@layer';
import {BackdropInput, DEFAULT_BACKDROP, DEFAULT_BACKDROP_NAME} from '@components/popups/myQrCode/colors';
import {BUILT_IN_BACKDROPS, isBuiltInBackdropId} from '@components/popups/myQrCode/backdropTable';

/**
 * What a share theme looks like, apart from how it is drawn. Pure: the screen reads the served `ShareTheme` and the
 * list of backdrops through here, so a test needs no DOM.
 */

/** The most emoji a theme holds (`QrShareView.MAX_EMOJI`) */
export const MAX_THEME_EMOJI = 6;

export type ThemeKind = 'default' | 'color' | 'emoji';

export type ThemeEmoji = {
  /** A plain emoji */
  emoticon?: string,
  /** A custom one */
  documentId?: DocId
};

export type Appearance = {
  kind: ThemeKind,
  backdrop: BackdropInput,
  /** The server's id of the backdrop, when one is picked */
  backdropId?: number,
  emojis: ThemeEmoji[]
};

export function reactionToThemeEmoji(reaction: Reaction): ThemeEmoji | undefined {
  if(reaction._ === 'reactionEmoji') return {emoticon: reaction.emoticon};
  if(reaction._ === 'reactionCustomEmoji') return {documentId: reaction.document_id as DocId};
}

export const themeEmojiKey = (emoji: ThemeEmoji) => emoji.documentId ? 'c:' + emoji.documentId : emoji.emoticon;

/** The backdrop a theme without one wears: the served one named like the default, else the built-in look */
export function getDefaultBackdrop(backdrops?: ShareThemeBackdropOption[]): BackdropInput {
  return backdrops?.find((backdrop) => backdrop.name === DEFAULT_BACKDROP_NAME) || {...DEFAULT_BACKDROP, name: DEFAULT_BACKDROP_NAME};
}

function defaultAppearance(backdrops?: ShareThemeBackdropOption[]): Appearance {
  const backdrop = getDefaultBackdrop(backdrops);
  return {
    kind: 'default',
    backdrop,
    backdropId: (backdrop as ShareThemeBackdropOption).backdrop_id,
    emojis: []
  };
}

/**
 * @param theme the one the full peer holds; `undefined` while the full peer is not there
 * @param backdrops the served colours; `undefined` until they come, and then a theme naming one shows as the default
 */
export function shareThemeToAppearance(theme: ShareTheme | undefined, backdrops?: ShareThemeBackdropOption[]): Appearance {
  switch(theme?._) {
    case 'shareThemeEmojiBackdrop': {
      const emojis = (theme.emojis || []).map(reactionToThemeEmoji).filter(Boolean).slice(0, MAX_THEME_EMOJI);
      // a colour of the built-in table, picked before the served list came, stays itself until it is saved by its id
      const id = theme.backdrop_id;
      const backdrop = id === undefined ? undefined :
        backdrops?.find((option) => option.backdrop_id === id) ??
        (isBuiltInBackdropId(id) ? BUILT_IN_BACKDROPS.find((option) => option.backdrop_id === id) : undefined);
      // the default circle sends no id, and a served id naming the default backdrop reads as that circle
      const isDefault = !backdrop || backdrop.name === DEFAULT_BACKDROP_NAME;
      if(isDefault) {
        return {...defaultAppearance(backdrops), kind: emojis.length ? 'emoji' : 'default', emojis};
      }

      return {kind: emojis.length ? 'emoji' : 'color', backdrop, backdropId: backdrop.backdrop_id, emojis};
    }
  }

  return defaultAppearance(backdrops);
}

/* Editing: what a pick makes of the theme on show, and what is sent for it */

const isDefaultBackdrop = (backdrop: BackdropInput) => backdrop.name === DEFAULT_BACKDROP_NAME;

/** A colour of the built-in table has no server id to be sent by: it waits for the served list (`backdropWaitsForIds`) */
export const waitsForServedId = (appearance: Appearance) => {
  return !isDefaultBackdrop(appearance.backdrop) && isBuiltInBackdropId(appearance.backdropId);
};

/** A colour picked: `undefined` is the default circle. The emoji stay. */
export function withBackdrop(appearance: Appearance, backdrops: ShareThemeBackdropOption[] | undefined, option?: ShareThemeBackdropOption): Appearance {
  const backdrop = option && !isDefaultBackdrop(option) ? option : getDefaultBackdrop(backdrops);
  const isDefault = isDefaultBackdrop(backdrop);
  const {emojis} = appearance;
  return {
    kind: emojis.length ? 'emoji' : isDefault ? 'default' : 'color',
    backdrop,
    backdropId: (backdrop as ShareThemeBackdropOption).backdrop_id,
    emojis
  };
}

/** An emoji tapped: a toggle. A pick over a full set drops the oldest. */
export function withEmojiToggled(base: Appearance, emoji: ThemeEmoji): Appearance {
  const key = themeEmojiKey(emoji);
  const without = base.emojis.filter((item) => themeEmojiKey(item) !== key);
  const emojis = without.length < base.emojis.length ? without : [...base.emojis, emoji].slice(-MAX_THEME_EMOJI);
  return {
    kind: emojis.length ? 'emoji' : isDefaultBackdrop(base.backdrop) ? 'default' : 'color',
    backdrop: base.backdrop,
    backdropId: base.backdropId,
    emojis
  };
}

export type ShareThemeToSave = {
  /** What `messages.setShareTheme` takes */
  theme: ShareTheme,
  /** What the full peer holds afterwards */
  shown: ShareTheme
};

export function appearanceToShareTheme(appearance: Appearance): ShareThemeToSave {
  const hasBackdrop = !isDefaultBackdrop(appearance.backdrop) && appearance.backdropId !== undefined;
  if(!hasBackdrop && !appearance.emojis.length) {
    return {theme: {_: 'shareThemeDefault'}, shown: {_: 'shareThemeDefault'}};
  }

  const theme: ShareTheme.shareThemeEmojiBackdrop = {_: 'shareThemeEmojiBackdrop'};
  if(hasBackdrop) theme.backdrop_id = appearance.backdropId;
  if(appearance.emojis.length) {
    theme.emojis = appearance.emojis.map((emoji): Reaction => emoji.documentId ?
      {_: 'reactionCustomEmoji', document_id: emoji.documentId} :
      {_: 'reactionEmoji', emoticon: emoji.emoticon});
  }

  return {theme, shown: theme};
}
