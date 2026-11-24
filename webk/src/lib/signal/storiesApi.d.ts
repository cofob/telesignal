/*
 * TeleSignal: the provider's story shapes that Web K reads (`src/api/types/stories.ts` of Web A), and the Signal text
 * story that a Web K story item carries beside its media. Only the fields that Web K reads are listed.
 */

import type {StoryItem} from '@layer';
import type {SignalFormattedText, SignalPhoto, SignalReaction, SignalVideo} from '@lib/signal/signalApi';

export type SignalTextStoryStyle = 'default' | 'regular' | 'bold' | 'serif' | 'script' | 'condensed';

/** Web A's `ApiTextStory`: the colors and the background are CSS values */
export type SignalTextStory = {
  text?: string,
  style: SignalTextStoryStyle,
  textColor: string,
  textBackgroundColor?: string,
  background: string,
  linkPreview?: {url: string, title?: string, description?: string}
};

export type SignalStoryViews = {
  hasViewers?: true,
  viewsCount?: number,
  reactionsCount?: number,
  repliesCount?: number,
  recentViewerIds?: string[]
};

export type SignalStory = {
  '@type'?: 'story',
  id: number,
  peerId: string,
  date: number,
  expireDate: number,
  content: {
    text?: SignalFormattedText,
    photo?: SignalPhoto,
    video?: SignalVideo
  },
  textStory?: SignalTextStory,
  isOut?: true,
  fromId?: string,
  noForwards?: boolean,
  noReplies?: true,
  sentReaction?: SignalReaction,
  views?: SignalStoryViews
};

export type SignalTypeStory = SignalStory | {'@type'?: 'storySkipped' | 'storyDeleted', id: number, peerId: string};

export type SignalPeerStories = {
  byId: Record<number, SignalTypeStory>,
  orderedIds: number[],
  lastReadId?: number
};

export type SignalStoryView = {
  type: 'user' | 'reply' | 'forward' | 'repost',
  peerId: string,
  date: number,
  text?: SignalFormattedText,
  reaction?: SignalReaction
};

/** Web A's `ApiStoryDistributionList`: My Story with its block or allow list, or a custom list */
export type SignalStoryDistributionList = {
  id: string,
  name: string,
  memberIds: string[],
  areRepliesAllowed: boolean,
  isBlockList: boolean,
  isMyStory?: true
};

/** A Web K story item of a Signal story: a text story has no media of Telegram's, and a story may refuse replies */
export type SignalStoryItem = StoryItem.storyItem & {
  signal_text_story?: SignalTextStory,
  signal_no_replies?: true
};
