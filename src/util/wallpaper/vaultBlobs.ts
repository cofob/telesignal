// The wallpaper blobs that a passcode moves between plain IDB storage and its vault. Kept apart from `storage.ts`,
// which loads media through the API, so that Web K's page can set and remove the passcode with the same steps
import { MAIN_IDB_STORE } from '../browser/idb';
import { readWallpaperVaultBlobs, writeWallpaperVaultBlob } from '../passcode';

const WALLPAPER_STORE_KEY_PREFIX = 'wallpaper-';
const LOCK_SCREEN_WALLPAPER_STORE_KEY_PREFIX = 'lock-screen-wallpaper-';

export async function encryptWallpaperBlobs() {
  try {
    const storageKeys = await getPlaintextWallpaperKeys();
    for (const storageKey of storageKeys) {
      const blob = await MAIN_IDB_STORE.get<Blob>(storageKey);
      if (!blob) continue;

      await writeWallpaperVaultBlob(getWallpaperSlug(storageKey), blob);
    }

    await removePlaintextWallpaperBlobs(storageKeys);
  } catch (err) {
    await clearPlaintextWallpaperBlobs().catch(() => undefined);
    throw err;
  }
}

export async function restoreWallpaperBlobsFromPasscode() {
  const blobs = await readWallpaperVaultBlobs();
  const entries: [string, Blob][] = blobs.map(([slug, blob]) => [buildWallpaperStoreKey(slug), blob]);
  if (!entries.length) return;

  await MAIN_IDB_STORE.setMany(entries);
}

export async function clearPlaintextWallpaperBlobs() {
  const storageKeys = await getPlaintextWallpaperKeys();
  await removePlaintextWallpaperBlobs(storageKeys);
}

export async function clearLockScreenWallpaperBlobs() {
  const storageKeys = await getLockScreenWallpaperKeys();
  if (storageKeys.length) await MAIN_IDB_STORE.delMany(storageKeys);
}

export function buildWallpaperStoreKey(slug: string) {
  return `${WALLPAPER_STORE_KEY_PREFIX}${slug}`;
}

export function buildLockScreenWallpaperStoreKey(slug: string) {
  return `${LOCK_SCREEN_WALLPAPER_STORE_KEY_PREFIX}${slug}`;
}

export async function getLockScreenWallpaperKeys() {
  const storageKeys = await MAIN_IDB_STORE.keys();
  return storageKeys.filter(
    (storageKey): storageKey is string => (
      typeof storageKey === 'string' && storageKey.startsWith(LOCK_SCREEN_WALLPAPER_STORE_KEY_PREFIX)
    ),
  );
}

function getWallpaperSlug(storageKey: string) {
  return storageKey.slice(WALLPAPER_STORE_KEY_PREFIX.length);
}

async function getPlaintextWallpaperKeys() {
  const storageKeys = await MAIN_IDB_STORE.keys();
  return storageKeys.filter(
    (storageKey): storageKey is string => (
      typeof storageKey === 'string' && storageKey.startsWith(WALLPAPER_STORE_KEY_PREFIX)
    ),
  );
}

async function removePlaintextWallpaperBlobs(storageKeys: string[]) {
  if (!storageKeys.length) return;

  await MAIN_IDB_STORE.delMany(storageKeys);
}
