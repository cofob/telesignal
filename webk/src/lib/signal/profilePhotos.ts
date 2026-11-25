/*
 * TeleSignal: the profile photos of users and groups, which Web K's profile avatars and avatar viewer show. A Signal
 * profile or group has one avatar and no earlier ones, so the gallery holds that photo, as Web A's `fetchProfilePhotos`
 * gives it, and the full profiles carry it (`profile_photo`, `chat_photo`). The provider downloads it by its avatar
 * photo id (`photo<id>`).
 */

import type {MethodDeclMap} from '@layer';
import type {SignalMethodHandlers, SignalMethodHost} from '@lib/signal/methodHost';
import type {SignalPhoto} from '@lib/signal/signalApi';
import {getInputUserPeerId, getUserRef} from '@lib/signal/methodHost';
import {buildPhoto} from '@lib/signal/media';

export function buildProfilePhotoHandlers(host: SignalMethodHost): SignalMethodHandlers {
  return {
    'photos.getUserPhotos': (params: MethodDeclMap['photos.getUserPhotos']['req']) => getUserPhotos(host, params)
  };
}

async function getUserPhotos(host: SignalMethodHost, params: MethodDeclMap['photos.getUserPhotos']['req']) {
  const peerId = getInputUserPeerId(host, params.user_id);
  // * a page after the first one asks for the photos older than the avatar, which Signal does not keep
  const isFirstPage = !params.offset && !Number(params.max_id);
  const result: {photos: SignalPhoto[]} | undefined = peerId !== undefined && isFirstPage ?
    await host.call('fetchProfilePhotos', {peer: getUserRef(peerId)}) :
    undefined;
  const photos = (result?.photos ?? []).map(buildPhoto);
  return {_: 'photos.photos', photos, users: []} as MethodDeclMap['photos.getUserPhotos']['res'];
}
