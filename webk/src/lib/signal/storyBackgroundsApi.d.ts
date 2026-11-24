/*
 * TeleSignal: `src/util/storyBackgrounds.ts`, the text story backgrounds of Web A's story composer (Signal Desktop
 * `TextStoryCreator.dom.tsx`). The provider sends a text story with the index of one of them.
 */

export type StoryBackground = {color: number} | {angle: number, colors: number[], positions: number[]};

export const STORY_BACKGROUNDS: StoryBackground[];

/** The CSS background of a text story */
export function getStoryBackgroundCss(background: StoryBackground): string;
