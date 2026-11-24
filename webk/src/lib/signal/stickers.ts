/*
 * TeleSignal: the sticker packs of Web K's sticker panel, in its shapes (`@layer`). A pack's stickers are documents of
 * the provider's sticker media (`media.ts`), and a pack opens from its id and key, as Signal's links name it.
 */

import type {StickerKeyword, StickerPack, StickerSet, StickerSetCovered} from '@layer';
import type {SignalSticker, SignalStickerSet} from '@lib/signal/signalApi';
import {buildStickerDocument} from '@lib/signal/media';

/** A pack of the panel, with the first sticker as its thumbnail */
export function buildStickerSet(set: SignalStickerSet): StickerSet.stickerSet {
  return {
    _: 'stickerSet',
    pFlags: {},
    installed_date: set.installedDate,
    id: set.id,
    access_hash: set.accessHash,
    title: set.title,
    short_name: set.shortName,
    count: set.count,
    hash: 0,
    thumb_document_id: set.covers?.[0]?.id ?? set.stickers?.[0]?.id
  };
}

/** A pack that the featured packs offer, with its cover; a pack without stickers has none to show */
export function buildStickerSetCovered(set: SignalStickerSet, date: number): StickerSetCovered.stickerSetCovered | undefined {
  const cover = set.covers?.[0] ?? set.stickers?.[0];
  if(!cover) return undefined;
  return {_: 'stickerSetCovered', set: buildStickerSet(set), cover: buildStickerDocument(cover, date)};
}

/** The documents of a pack's stickers and the emoji they are listed under */
export function buildStickerSetContent(set: SignalStickerSet, date: number) {
  const stickers: SignalSticker[] = set.stickers ?? [];
  const keywords: StickerKeyword[] = [];
  const packs: StickerPack[] = Object.entries(set.packs ?? {}).map(([emoticon, emojiStickers]) => ({
    _: 'stickerPack',
    emoticon,
    documents: emojiStickers.map(({id}) => id)
  }));
  return {
    set: buildStickerSet(set),
    packs,
    keywords,
    documents: stickers.map((sticker) => buildStickerDocument(sticker, date))
  };
}
