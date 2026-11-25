import DEBUG from '@config/debug';
import {CommonState as StateCommon, State, COMMON_STATE_INIT, STATE_INIT, AppTheme} from '@config/state';
import compareVersion from '@helpers/compareVersion';
import copy from '@helpers/object/copy';
import validateInitObject from '@helpers/object/validateInitObject';
import sessionStorage from '@lib/sessionStorage';
import {StoragesResults} from '@appManagers/utils/storages/loadStorages';
import {LogTypes, logger} from '@lib/logger';
import {ActiveAccountNumber} from '@lib/accounts/types';
import StateStorage from '@lib/stateStorage';
import AccountController from '@lib/accounts/accountController';
import noop from '@helpers/noop';
import commonStateStorage from '@lib/commonStateStorage';

export type LoadStateResult = {
  state: State,
  common: StateCommon,
  resetStorages: Map<keyof StoragesResults, (PeerId | UserId | ChatId)[]>,
  newVersion: string,
  oldVersion: string,
  pushedKeys: Set<keyof State>,
  userId: UserId
};

const REFRESH_EVERY = 24 * 60 * 60 * 1000; // 1 day
// const REFRESH_EVERY = 1e3;
// const REFRESH_EVERY_WEEK = 24 * 60 * 60 * 1000 * 7; // 7 days

const STATE_VERSION = STATE_INIT.version;
const BUILD = STATE_INIT.build;

const ALL_KEYS = Object.keys(STATE_INIT) as any as Array<keyof State>;
const COMMON_KEYS = Object.keys(COMMON_STATE_INIT) as any as Array<keyof StateCommon>;

const REFRESH_KEYS: Array<keyof State> = [
  'contactsListCachedTime',
  'stateCreatedTime',
  'maxSeenMsgId',
  'filtersArr'
];

// * the version is not among them: it is kept as seen once its message is in the "Telegram" chat
// * (apiUpdatesManager.deliverChangelog), so a start that stops on the way leaves the message for the next one
const RESET_WITH_BUILD: Array<keyof State> = [
  'appConfig',
  'build'
];

// const REFRESH_KEYS_WEEK = ['dialogs', 'allDialogsLoaded', 'updates', 'pinnedOrders'] as any as Array<keyof State>;

function AnyStateWriter<S>(log: ReturnType<typeof logger>, keys: string[], init: S) {
  const pushedKeys: Set<keyof S> = new Set();
  const pushToState = <T extends keyof S>(key: T, value: S[T]) => {
    state[key] = value;
    pushedKeys.add(key);
  };

  const replaceState = (_state: S) => {
    pushedKeys.clear();
    state = _state;
    (Object.keys(state) as any as Array<keyof S>).forEach((key) => pushedKeys.add(key));
  };

  let state: S = {} as any;

  const readFromArray = (arr: any[]) => {
    // ! then can't store false values
    for(let i = 0, length = keys.length; i < length; ++i) {
      const key = keys[i];
      const value = arr[i];
      if(value !== undefined) {
        // @ts-ignore
        state[key] = value;
      } else {
        // @ts-ignore
        pushToState(key, copy(init[key]));
      }
    }
  };

  return {
    push: pushToState,
    replace: replaceState,
    readFromArray,
    get state() {
      return state;
    },
    set state(_state: S) {
      state = _state;
    },
    pushedKeys,
    log
  };
}

function StateWriter(log: ReturnType<typeof logger>) {
  const w = AnyStateWriter<State>(log, ALL_KEYS, STATE_INIT);

  const resetStorages: Map<keyof StoragesResults, []> = new Map();
  const resetState = ({
    preserveKeys = []
    // preserveCommonKeys = []
  }: Partial<{
    preserveKeys: (keyof State)[]
    // preserveCommonKeys: typeof COMMON_KEYS[number][]
  }> = {}) => {
    preserveKeys.push('authState'/* , 'stateId' */);
    const preserve: Map<keyof State, State[keyof State]> = new Map(
      preserveKeys.map((key) => [key, w.state[key]])
    );

    w.state = copy(STATE_INIT);

    preserve.forEach((value, key) => {
      // @ts-ignore
      w.state[key] = value;
    });

    const r: (keyof StoragesResults)[] = ['chats', 'dialogs', 'users'];
    for(const key of r) {
      resetStorages.set(key, []);
    }

    w.replace(w.state);
  };

  return {
    ...w,
    get state() {
      return w.state;
    },
    set state(_state) {
      w.state = _state;
    },
    resetStorages,
    reset: resetState
  };
}

function CommonStateWriter(log: ReturnType<typeof logger>) {
  const w = AnyStateWriter<StateCommon>(log, COMMON_KEYS, COMMON_STATE_INIT);
  return w;
}

const STATE_STEPS = {
  REFRESH: (writer: ReturnType<typeof StateWriter>) => {
    const time = Date.now();
    if((writer.state.stateCreatedTime + REFRESH_EVERY) < time) {
      if(DEBUG) {
        writer.log('will refresh state', writer.state.stateCreatedTime, time);
      }

      REFRESH_KEYS.forEach((key) => {
        writer.push(key, copy(STATE_INIT[key]));
      });
    }
  },
  VALIDATE: <T>(writer: ReturnType<typeof AnyStateWriter<T>>, init: T) => {
    const SKIP_VALIDATING_PATHS: Set<string> = new Set([
      'settings.themes'
    ]);

    validateInitObject(init, writer.state, (missingKey) => {
      writer.push(
        missingKey as keyof typeof init,
        writer.state[missingKey as keyof typeof init]
      );
    }, undefined, SKIP_VALIDATING_PATHS);
  },
  // Idempotent migration: legacy state stored AppTheme.settings as a single ThemeSettings;
  // the new shape mirrors the MTProto Theme.settings array (one entry per BaseTheme), so
  // switching dark/light keeps a cloud theme's per-base customizations. Wrap any leftover
  // singular settings into a one-element array — getThemeSettings handles the rest.
  MIGRATE_THEMES: (writer: ReturnType<typeof CommonStateWriter>) => {
    const themes = writer.state.settings?.themes as AppTheme[] | undefined;
    if(!themes) return;
    let migrated = false;
    themes.forEach((theme) => {
      if(theme.settings && !Array.isArray(theme.settings)) {
        theme.settings = [theme.settings as any];
        migrated = true;
      }
    });
    if(migrated) {
      writer.push('settings', writer.state.settings);
    }
  },
  RESET_DIALOG_LIST: (writer: ReturnType<typeof StateWriter>) => {
    writer.resetStorages.set('dialogs', []);
    writer.push('allDialogsLoaded', copy(STATE_INIT.allDialogsLoaded));
    writer.push('dialogsPaginationOffsets', copy(STATE_INIT.dialogsPaginationOffsets));
    writer.push('pinnedOrders', copy(STATE_INIT.pinnedOrders));
  },
  VERSION: (writer: ReturnType<typeof StateWriter>) => {
    let newVersion: string, oldVersion: string;
    // * the migrations go with the build, which is written at once; the version stays as it was until its
    // * message has come, and every start until then finds it new
    if(writer.state.build !== BUILD/*  || true */) {
      if(writer.state.build < 526) { // * drop all previous migrations
        writer.reset();
      } else if(writer.state.build < 562) { // * drop filtersArr
        writer.push('filtersArr', copy(STATE_INIT.filtersArr));
      } else if(writer.state.build < 677) {
        STATE_STEPS.RESET_DIALOG_LIST(writer);
        writer.push('botCommands', copy(STATE_INIT.botCommands));
      } else if(writer.state.build < 687) {
        // * the dialogs the old pagination skipped (a dialog out of date order made the next page jump over
        // * everything between) were marked as loaded: load the list again
        STATE_STEPS.RESET_DIALOG_LIST(writer);
      }

      RESET_WITH_BUILD.forEach((key) => {
        writer.push(key, copy(STATE_INIT[key]));
      });
    }

    if(compareVersion(writer.state.version, STATE_VERSION) !== 0) {
      newVersion = STATE_VERSION;
      oldVersion = writer.state.version;
    }

    return {newVersion, oldVersion};
  },
  /**
   * Web A signs accounts in and out of the same slots, and knows nothing of what is kept of them here: what
   * was kept for another user, or for one signed out of the slot since, is dropped
   */
  CHANGED_USER: (writer: ReturnType<typeof StateWriter>, userId: UserId) => {
    const {state} = writer;
    const wasSignedIn = state.authState._ === 'authStateSignedIn';
    // * a state from before it was kept whose user it is can only be told by being signed in
    if(state.userId === undefined ? !userId && wasSignedIn : state.userId !== userId) {
      writer.log.warn('the account has changed', state.userId, userId);
      writer.reset();
      if(!userId) {
        writer.push('authState', copy(STATE_INIT.authState));
      }
    }
  }
};

async function loadStateForAccount(accountNumber: ActiveAccountNumber): Promise<LoadStateResult> {
  const log = logger(`STATE-LOADER-ACCOUNT-${accountNumber}`);
  const stateStorage = new StateStorage(accountNumber);

  const [accountData, ...arr] = await Promise.all([
    AccountController.get(accountNumber),
    ...COMMON_KEYS.map((key) => commonStateStorage.get(key)),
    ...ALL_KEYS.map((key) => stateStorage.get(key))
  ]);

  const commonWriter = CommonStateWriter(log);
  commonWriter.readFromArray(arr.splice(0, COMMON_KEYS.length));

  const writer = StateWriter(log);
  writer.readFromArray(arr);

  // * Web A's account of the test servers is not one this client can open
  const userId = AccountController.isSignedIn(accountData) ? accountData.userId : undefined;
  STATE_STEPS.CHANGED_USER(writer, userId);

  // * a slot with a DC is a signed-in account to Web A (`loadSlotSession`): a Telegram sign-in that an older version
  // * left unfinished is no account, and its DC goes once. Web A's own slots are left alone
  if(!accountData.userId && accountData.dcId && !accountData.isLinked && !AccountController.isForeign(accountData)) {
    await AccountController.update(accountNumber, (data) => {
      return !data.userId && data.dcId ? {dcId: undefined} : undefined;
    });
  }

  if(userId) {
    writer.state.authState = {_: 'authStateSignedIn'};
  }

  STATE_STEPS.REFRESH(writer);
  STATE_STEPS.VALIDATE(writer, STATE_INIT);
  STATE_STEPS.VALIDATE(commonWriter, COMMON_STATE_INIT);
  STATE_STEPS.MIGRATE_THEMES(commonWriter);
  // * a state that could not be read (its database did not open: an older version's tab held it at its own
  // * version) is not a new one: the defaults it was filled with are not written over what is kept, and its
  // * version is not taken for one the app was updated from
  const unreadable = !stateStorage.isAvailable();
  const {newVersion, oldVersion} = unreadable ? {newVersion: undefined, oldVersion: undefined} : STATE_STEPS.VERSION(writer);

  if(writer.state.userId !== userId) {
    writer.push('userId', userId);
  }

  if(unreadable) {
    log.error('the state could not be read: nothing of it is written');
    writer.pushedKeys.clear();
    writer.resetStorages.clear();
  }

  return {
    state: writer.state,
    pushedKeys: writer.pushedKeys,
    newVersion,
    oldVersion,
    resetStorages: writer.resetStorages,
    common: commonWriter.state,
    userId
  };
}

async function applyBuildVersionToStorage() {
  const sessionBuild = await sessionStorage.get('k_build');
  if(sessionBuild !== BUILD && (!sessionBuild || sessionBuild < BUILD)) {
    await sessionStorage.set({k_build: BUILD});
  }
}

async function loadStateForAllAccounts() {
  const perf = performance.now();

  // * the Telegram session values that earlier versions kept beside the slots go once; a failure leaves them unread
  AccountController.clearLegacySessionKeys().catch(noop);

  const [stateForFirstAccount, ...rest] = await Promise.all([
    loadStateForAccount(1),
    loadStateForAccount(2),
    loadStateForAccount(3),
    loadStateForAccount(4)
  ]);

  applyBuildVersionToStorage();

  if(DEBUG) {
    console.log('loadStateForAllAccounts time', performance.now() - perf);
  }

  return {
    1: stateForFirstAccount,
    2: rest[0],
    3: rest[1],
    4: rest[2]
  };
}

let promise: ReturnType<typeof loadStateForAllAccounts>;
export default function loadStateForAllAccountsOnce() {
  return promise ??= loadStateForAllAccounts();
}
