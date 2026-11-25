import {MOUNT_CLASS_TO} from '@config/debug';
import Modes from '@config/modes';
import type {EmojiStatus, User} from '@layer';

import sessionStorage from '@lib/sessionStorage';
import StaticUtilityClass from '@lib/staticUtilityClass';

import {AccountSessionData, ActiveAccountNumber, SessionUserFields, StoredAccountSessionData} from '@lib/accounts/types';
import noop from '@helpers/noop';
import {toPeerId, toSignalPeerId} from '@lib/signal/builders';

const ACCOUNT_NUMBERS: ActiveAccountNumber[] = [1, 2, 3, 4];
// * the Telegram session that earlier versions kept beside the first slot, as Web A's `clearLegacySessionKeys` lists it
const LEGACY_SESSION_KEYS = [
  'user_auth',
  'dc',
  'auth_key_fingerprint',
  ...[1, 2, 3, 4, 5].flatMap((dcId) => [`dc${dcId}_auth_key`, `dc${dcId}_hash`, `dc${dcId}_server_salt`])
] as const;
// * what earlier versions wrote into a slot of a Telegram sign-in: a slot's next write leaves it out
const LEGACY_SLOT_FIELDS = [
  'auth_key_fingerprint',
  'push_key',
  'push_key_fingerprint',
  'sign_in_dc_id',
  'temp_auth_keys',
  ...[1, 2, 3, 4, 5].flatMap((dcId) => [`dc${dcId}_auth_key`, `dc${dcId}_server_salt`])
];
const SESSION_USER_FIELDS: (keyof SessionUserFields)[] = ['firstName', 'lastName', 'phone', 'color', 'isPremium', 'emojiStatusId'];

type AccountDataChanges = Partial<AccountSessionData> | ((data: AccountSessionData) => Partial<AccountSessionData> | undefined);

export class AccountController extends StaticUtilityClass {
  // * the write in progress of each account: every update reads the whole data, merges and writes it
  // * back, so two at once would lose one of them
  private static updates: Map<ActiveAccountNumber, Promise<unknown>> = new Map();

  static async getTotalAccounts() {
    return (await this.getAccounts()).length;
  }

  static async getUnencryptedTotalAccounts() {
    return sessionStorage.get('number_of_accounts');
  }

  /**
   * The signed-in accounts, by their slots. Web A keeps its accounts in the same slots and leaves one empty
   * when its account signs out, so they are not always the first ones; and its accounts of the test
   * servers are not K's (see isForeign)
   */
  static async getAccounts() {
    const accounts = await Promise.all(ACCOUNT_NUMBERS.map(async(accountNumber) => {
      return [accountNumber, await this.get(accountNumber)] as const;
    }));

    return accounts.filter(([, accountData]) => this.isSignedIn(accountData));
  }

  static async getAccountNumbers() {
    return (await this.getAccounts()).map(([accountNumber]) => accountNumber);
  }

  static async getUserIds() {
    return (await this.getAccounts()).map(([, accountData]) => accountData.userId);
  }

  /**
   * The slot a new account goes to: the first one nobody is signed in to here or in Web A
   */
  static async getFreeAccountNumber() {
    for(const accountNumber of ACCOUNT_NUMBERS) {
      const accountData = await this.get(accountNumber);
      if(!accountData.userId && !accountData.isTest) {
        return accountNumber;
      }
    }
  }

  static isSignedIn(accountData: AccountSessionData) {
    // * TeleSignal: a slot of Telegram's earlier versions holds no Signal account
    return !!accountData.userId && !!accountData.isLinked && !this.isForeign(accountData);
  }

  /**
   * An account Web A has on the test servers, in a slot of production ones: this client can't use it, and
   * leaves it as it is
   */
  static isForeign(accountData: AccountSessionData) {
    return !!accountData.isTest && !Modes.test;
  }

  /**
   * Who the account is, as Web A writes it to the account's slot from its own user (useMultiaccountInfo): its
   * menu of accounts shows the accounts it has not opened yet from these
   */
  static getSessionUserFields(user: User.user): SessionUserFields {
    const emojiStatus = user.emoji_status as EmojiStatus.emojiStatus | EmojiStatus.emojiStatusCollectible;
    return {
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      color: user.color?._ === 'peerColor' ? user.color.color : undefined,
      isPremium: !!user.pFlags.premium,
      emojiStatusId: emojiStatus?.document_id ? '' + emojiStatus.document_id : undefined
    };
  }

  static isSameSessionUserFields(a: SessionUserFields, b: SessionUserFields) {
    return SESSION_USER_FIELDS.every((key) => a[key] === b[key]);
  }

  /**
   * What the slot has otherwise, or only what it lacks: Web A may have written there what is newer
   */
  static getSessionUserFieldsChanges(fields: SessionUserFields, slot: SessionUserFields, onlyMissing?: boolean) {
    const changes: Record<string, SessionUserFields[keyof SessionUserFields]> = {};
    for(const key of SESSION_USER_FIELDS) {
      if(fields[key] !== slot[key] && (!onlyMissing || slot[key] === undefined)) {
        changes[key] = fields[key];
      }
    }

    return Object.keys(changes).length ? changes as SessionUserFields : undefined;
  }

  static async get(accountNumber: ActiveAccountNumber) {
    const stored: StoredAccountSessionData = await sessionStorage.get(`account${accountNumber}`);
    const data = {...stored} as AccountSessionData;
    // * TeleSignal: the slot keeps Web A's id of the user, which Web K moves past its own small ids
    if(stored?.userId !== undefined) {
      data.userId = toPeerId(stored.userId);
    }

    return data;
  }

  /**
   * One at a time per account. `changes` can be a function of the data as it is at that moment, and
   * can return `undefined` to write nothing
   */
  static update(accountNumber: ActiveAccountNumber, changes: AccountDataChanges, overrideAll = false) {
    const promise = (this.updates.get(accountNumber) || Promise.resolve())
    .catch(noop)
    .then(() => this.write(accountNumber, changes, overrideAll));
    this.updates.set(accountNumber, promise);
    return promise;
  }

  /**
   * Settles once the updates of the account asked for so far are written
   */
  static async whenUpdated(accountNumber: ActiveAccountNumber) {
    await this.updates.get(accountNumber)?.catch(noop);
  }

  private static async write(accountNumber: ActiveAccountNumber, changes: AccountDataChanges, overrideAll: boolean) {
    const prevData = await this.get(accountNumber);
    // * Web A's account of the other servers stays as Web A wrote it
    if(this.isForeign(prevData)) {
      return prevData;
    }

    const data = typeof(changes) === 'function' ? changes(prevData) : changes;
    if(!data) {
      return prevData;
    }

    const updatedData = {
      ...(overrideAll ? {} : prevData),
      ...data
    };
    for(const field of LEGACY_SLOT_FIELDS) {
      delete (updatedData as Record<string, unknown>)[field];
    }

    // * as Web A writes and compares it
    const stored: StoredAccountSessionData = {...updatedData};
    if(updatedData.userId !== undefined) {
      stored.userId = toSignalPeerId(updatedData.userId);
    }

    await sessionStorage.set({
      [`account${accountNumber}`]: stored
    });

    (async() => {
      sessionStorage.set({
        number_of_accounts: await this.getTotalAccounts()
      });
    })();

    return updatedData;
  }

  /** Empties the slot of an account that logged out */
  static async remove(accountNumber: ActiveAccountNumber) {
    await this.whenUpdated(accountNumber);
    await sessionStorage.delete(`account${accountNumber}`);

    await sessionStorage.set({number_of_accounts: await this.getTotalAccounts()});
  }

  /**
   * Removes the Telegram session values that earlier versions kept beside the first slot for Web A, as Web A's
   * `clearLegacySessionKeys` does: nothing reads them. Only the plain copies go; a copy behind a passcode stays unread
   */
  static async clearLegacySessionKeys() {
    await Promise.all(LEGACY_SESSION_KEYS.map((key) => sessionStorage.localStorageProxy('delete', key)));
  }
}

MOUNT_CLASS_TO.AccountController = AccountController;

export default AccountController;
