import {MOUNT_CLASS_TO} from '@config/debug';

import type {AppInstance} from '@lib/singleInstance';
import LocalStorageController from '@lib/localStorage';
import {StoredAccountSessionData} from '@lib/accounts/types';

type StorageValues = {
  state_id: number,

  account1: StoredAccountSessionData,
  account2: StoredAccountSessionData,
  account3: StoredAccountSessionData,
  account4: StoredAccountSessionData,

  // @deprecated the passcode key is handed over in window.sessionStorage now
  // (@lib/passcode/keyHandoff) — kept only so old, on-disk values can be purged
  encryption_key?: string,

  xt_instance: AppInstance,
  kz_version: 'K' | 'Z',
  tgme_sync: {
    canRedirect: boolean,
    ts: number
  },
  k_build: number,

  // auth options
  number_of_accounts?: number, // When the storage is encrypted
  previous_account?: number, // only for back button when logging in to another account
  current_account?: number, // 1 if not set
  should_animate_main?: number
}

const sessionStorage = new LocalStorageController<StorageValues>([
  'account1',
  'account2',
  'account3',
  'account4'
]);

MOUNT_CLASS_TO.appStorage = sessionStorage;
export default sessionStorage;
