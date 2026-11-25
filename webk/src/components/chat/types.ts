import type ChatThreadSeparator from '@components/chat/bubbleParts/chatThreadSeparator';

export type BubbleElementAddons = {
  chatThreadSeparator?: InstanceType<typeof ChatThreadSeparator>;
  /** how many items of its album the bubble was rendered with */
  groupedLength?: number;
};
