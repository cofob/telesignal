/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

/*
 * TeleSignal: the API of the managers without Telegram. Requests go to the Signal engine through
 * `appSignalManager`, never to a network of Telegram's: the MTProto networkers, transports and data centers of
 * upstream are gone. The methods that other managers call keep their names and shapes.
 */

import type {UserAuth} from '@appManagers/constants';
import type {DcId, InvokeApiOptions, TrueDcId} from '@types';
import type {MethodDeclMap} from '@layer';
import sessionStorage from '@lib/sessionStorage';
import deferredPromise, {CancellablePromise} from '@helpers/cancellablePromise';
import {IDB} from '@lib/files/idb';
import noop from '@helpers/noop';
import ApiManagerMethods from '@appManagers/apiManagerMethods';
import tsNow from '@helpers/tsNow';
import AccountController from '@lib/accounts/accountController';
import {AppStoragesManager} from '@appManagers/appStoragesManager';
import commonStateStorage from '@lib/commonStateStorage';
import CacheStorageController from '@lib/files/cacheStorage';
import {ActiveAccountNumber} from '@lib/accounts/types';
import makeError from '@helpers/makeError';
import EncryptedStorageLayer from '@lib/encryptedStorageLayer';
import {getCommonDatabaseState} from '@config/databases/state';
import clearSignalLocalData from '@signal-app/clear-local-data';
/**
 * To not be used in an ApiManager instance as there is no account number attached to it
 */
import globalRootScope from '@lib/rootScope';

// * the data center Web K's code expects every account to have; nothing connects to it
const SIGNAL_DC_ID = 2 as TrueDcId;

export class ApiManager extends ApiManagerMethods {
  private loggingOut: boolean;
  private updatesProcessor: (obj: any) => void;

  constructor() {
    super();
    this.name = 'API';
  }

  public getMemoryStats() {
    return {
      networkers: 0,
      sentMessages: 0,
      sentMessageBodyBytes: 0,
      pendingMessages: 0,
      pendingAcks: 0,
      sentResendReq: 0,
      lastServerMessages: 0
    };
  }

  public async getBaseDcId() {
    return SIGNAL_DC_ID;
  }

  public async setUserAuth(userAuth: UserAuth | UserId) {
    if(typeof(userAuth) === 'string' || typeof(userAuth) === 'number') {
      userAuth = {dcID: SIGNAL_DC_ID, date: tsNow(true), id: userAuth.toPeerId(false)};
    }

    this.rootScope.dispatchEvent('user_auth', userAuth);

    // * the slot marker of Web A (`src/util/sessions.ts`): with `isLinked` both frontends open the account. No data
    // * center is written, which Web A would take for a Telegram session of earlier versions
    await AccountController.update(this.getAccountNumber(), {
      isLinked: true,
      date: (userAuth as UserAuth).date,
      userId: (userAuth as UserAuth).id
    });

    this.appAccountManager.saveSessionUser();
  }

  public setBaseDcId(dcId: DcId) {
    return dcId === SIGNAL_DC_ID;
  }

  /**
   * Logs the account of this slot out, as Web A's sign-out does (`signOut` in `src/global/actions/api/initial.ts`): the
   * engine unlinks the device and forgets the account, then the slot and this client's data of it go. The slot stays
   * linked until the engine's data is gone, so that a log out cut short leaves no linked slot without its account or
   * account without its slot; a wipe that fails rejects, and the slot stays for another try. The slots of the other
   * accounts keep their numbers: the engine's stores are named by them (`getEngineStoreName`).
   */
  public async logOut(migrateAccountTo?: ActiveAccountNumber) {
    if(this.loggingOut) {
      return;
    }

    this.loggingOut = true;

    const accountNumber = this.getAccountNumber();
    try {
      // * the unlink request is answered or has failed before the data goes, which a worker terminated earlier would cut
      await this.appSignalManager.logOut().catch(noop);
      // * the engine may not have run in this worker, such as before the passcode was entered
      await clearSignalLocalData();
    } catch(err) {
      this.loggingOut = false;
      throw err;
    }

    await AccountController.whenUpdated(accountNumber);
    const totalAccounts = await AccountController.getTotalAccounts();
    const isLastAccount = totalAccounts <= 1 && !migrateAccountTo;
    await Promise.all([
      AccountController.remove(accountNumber),
      AppStoragesManager.clearAllStoresForAccount(accountNumber),
      ...(isLastAccount ? [
        sessionStorage.delete('k_build'),
        AppStoragesManager.clearSessionStores(),
        commonStateStorage.clear(),
        EncryptedStorageLayer.getInstance(getCommonDatabaseState(), 'localStorage__encrypted').clear(),
        CacheStorageController.deleteAllStorages()
      ] : [])
    ]);

    IDB.closeDatabases();
    this.rootScope.dispatchEvent('logging_out', {accountNumber, migrateTo: migrateAccountTo});
  }

  public static async forceLogOutAll() {
    const clearAllStoresPromises = ([1, 2, 3, 4] as ActiveAccountNumber[])
    .map(accountNumber => AppStoragesManager.clearAllStoresForAccount(accountNumber));

    await Promise.all([
      sessionStorage.localStorageProxy('clear'),
      commonStateStorage.clear(),
      EncryptedStorageLayer.getInstance(getCommonDatabaseState(), 'localStorage__encrypted').clear(),
      ...clearAllStoresPromises,
      CacheStorageController.deleteAllStorages()
    ]);

    IDB.closeDatabases();
    globalRootScope.dispatchEvent('logging_out', {});
  }

  // * Telegram's passkey sign-in from another data center, which Signal has not
  public getAuthKeyFromHex(_authKeyHex: string): Promise<{id: Uint8Array}> {
    return Promise.reject(makeError('SIGNAL_METHOD_UNSUPPORTED' as ErrorType));
  }

  public getNetworkerVoid(_dcId: DcId) {
    return Promise.resolve();
  }

  public setUpdatesProcessor(callback: (obj: any) => void) {
    this.updatesProcessor = callback;
  }

  public invokeApi<T extends keyof MethodDeclMap>(method: T, params: MethodDeclMap[T]['req'] = {}, options: InvokeApiOptions = {}): CancellablePromise<MethodDeclMap[T]['res']> {
    const deferred = deferredPromise<MethodDeclMap[T]['res']>();
    this.appSignalManager.invoke(method, params).then((result) => deferred.resolve(result), (error: ApiError) => {
      if(options.ignoreErrors || options.noErrorBox) {
        error.handled = true;
      }

      deferred.reject(error);
    });

    return deferred;
  }
}
