/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import tsNow from '@helpers/tsNow';
import {Chat, InputNotifyPeer, InputPeerNotifySettings, NotifyPeer, PeerNotifySettings, ReactionsNotifySettings, Update, Updates} from '@layer';
import {MUTE_UNTIL} from '@appManagers/constants';
import throttle from '@helpers/schedulers/throttle';
import convertInputKeyToKey from '@helpers/string/convertInputKeyToKey';
import noop from '@helpers/noop';
import {AppManager} from '@appManagers/manager';
import ctx from '@environment/ctx';
import assumeType from '@helpers/assumeType';
import appTabsManager from '@appManagers/appTabsManager';
import commonStateStorage from '@lib/commonStateStorage';
import MTProtoMessagePort from '@lib/mainWorker/mainMessagePort';
import type {
  NotificationBuildMessageTaskPayload,
  NotificationBuildStoryTaskPayload,
  NotificationBuildStoryReactionTaskPayload,
  NotificationBuildTaskPayload
} from '@lib/apiManagerProxy';
import type {MyTopPeer} from '@appManagers/appUsersManager';
import type {GlobalNotifySettingsKey} from '@config/state';

/** what a notification's builder provides — the routing fields are filled in by the router */
type NotificationBuildPayload =
  Omit<NotificationBuildMessageTaskPayload, 'accountNumber' | 'isOtherTabActive'> |
  Omit<NotificationBuildStoryTaskPayload, 'accountNumber' | 'isOtherTabActive'> |
  Omit<NotificationBuildStoryReactionTaskPayload, 'accountNumber' | 'isOtherTabActive'>;

type ImSadAboutIt = Promise<PeerNotifySettings> | PeerNotifySettings;
type MyNotifyPeer = NotifyPeer.notifyUsers['_'] | NotifyPeer.notifyChats['_'] | NotifyPeer.notifyBroadcasts['_'];
type MyInputNotifyPeer =
  InputNotifyPeer.inputNotifyUsers['_'] |
  InputNotifyPeer.inputNotifyChats['_'] |
  InputNotifyPeer.inputNotifyBroadcasts['_'];
/** the settings a chat keeps of its own, under the key they are kept by */
type OwnSettingsKey = 'notifyPeer';

const NOTIFY_PEER_TYPES: MyInputNotifyPeer[] = ['inputNotifyBroadcasts', 'inputNotifyUsers', 'inputNotifyChats'];

/** The settings clock's key of what is kept under `key` of `kind` (a type's settings are of the kind `type`) */
const getSettingsClockKey = (kind: OwnSettingsKey | 'type' | 'reactions', key: string | number) => kind + ':' + key;
const REACTIONS_CLOCK_KEY = getSettingsClockKey('reactions', '');

/** A chat of a type whose own settings make it an exception to the type's (tdesktop's: its own `mute_until`) */
export type NotifyException = {peerId: PeerId, muted: boolean};
export class AppNotificationsManager extends AppManager {
  private peerSettings = {
    notifyPeer: {} as {[peerId: string]: ImSadAboutIt},
    notifyUsers: null as ImSadAboutIt,
    notifyChats: null as ImSadAboutIt,
    notifyBroadcasts: null as ImSadAboutIt
  };
  // * the exceptions of each chat type, newest first, peerId -> muted; kept up to date once the type's are asked for
  private exceptions: Partial<Record<GlobalNotifySettingsKey, Map<PeerId, boolean>>>;
  // * Reset All on its way: every request of these settings goes out after it, so that none crosses it
  private resetting: Promise<void>;
  // * The settings clock: a tick with every change of settings here (a local edit, or one the server pushes), kept
  // * by the key they changed under (`settingsChangedAt`), and with every Reset All that went through
  // * (`settingsResetAt`). An answer asked for at a tick (`askedAt`) holds nothing newer than what changed after it,
  // * so it is not kept for that (savePeerSettings), and after such a reset it is out of date as a whole (`stale`)
  private settingsClock = 0;
  private settingsResetAt = 0;
  private settingsChangedAt = new Map<string, number>();

  private getNotifyPeerTypePromise: Promise<any>;

  private checkMuteUntilTimeout: number;
  private checkMuteUntilThrottled: () => void;

  private notifyContactsSignUp: Promise<boolean>;

  private reactionsNotifySettings: Promise<ReactionsNotifySettings> | ReactionsNotifySettings;

  protected after() {
    this.checkMuteUntilThrottled = throttle(this.checkMuteUntil, 1000, false);

    this.apiUpdatesManager.addMultipleEventsListeners({
      updateNotifySettings: this.onUpdateNotifySettings
    });

    return this.appStateManager.getState().then((state) => {
      if(state.notifySettings) {
        for(const key in state.notifySettings) {
          assumeType<MyNotifyPeer>(key);
          this.savePeerSettings({
            key,
            settings: state.notifySettings[key]
          });
        }
      }
    });
  }

  public getNotifySettings(peer: InputNotifyPeer): ImSadAboutIt {
    let key: any = convertInputKeyToKey(peer._);
    let obj: any = this.peerSettings[key as MyNotifyPeer];

    let peerId: PeerId;
    if(peer._ === 'inputNotifyPeer') {
      peerId = this.appPeersManager.getPeerId(peer.peer);
      key = this.getPeerKey(peerId);
      obj = obj[key];
    }

    if(obj) {
      return obj;
    }

    const container: any = peerId ?
      this.peerSettings.notifyPeer :
      this.peerSettings;
    const promise: Promise<PeerNotifySettings> = container[key] = this.invokeAfterReset(() => {
      return this.apiManager.invokeApi('account.getNotifySettings', {peer});
    }).then(({result: settings, askedAt, stale}) => {
      // * a Reset All went through while it was asked: asked again, after it
      if(stale) {
        if(container[key] === promise) delete container[key];
        return this.getNotifySettings(peer);
      }

      // * or what changed here since, which is kept in their place
      return this.savePeerSettings({
        key,
        peerId,
        settings,
        askedAt
      });
    });

    return promise;
  }

  public getNotifyPeerTypeSettings() {
    if(this.getNotifyPeerTypePromise) return this.getNotifyPeerTypePromise;

    const promises = NOTIFY_PEER_TYPES.map((inputKey) => {
      return this.getNotifySettings({_: inputKey});
    });

    return this.getNotifyPeerTypePromise = Promise.all(promises);
  }

  public generateLocalNotifySettingsUpdate(peer: InputNotifyPeer, settings: InputPeerNotifySettings) {
    const notifyPeer: NotifyPeer = {
      ...peer as any,
      _: convertInputKeyToKey(peer._)
    };

    // * the sounds go out as this client's own and come back per platform: this client's one is `other`
    const {sound, stories_sound, ...rest} = settings;
    const notifySettings: PeerNotifySettings = {...rest, _: 'peerNotifySettings'};
    if('sound' in settings) notifySettings.other_sound = sound;
    if('stories_sound' in settings) notifySettings.stories_other_sound = stories_sound;

    this.apiUpdatesManager.processLocalUpdate({
      _: 'updateNotifySettings',
      peer: notifyPeer,
      notify_settings: notifySettings
    });
  }

  public updateNotifySettings(peer: InputNotifyPeer, settings: InputPeerNotifySettings) {
    // this.savePeerSettings(peerId, settings);

    /* const inputSettings: InputPeerNotifySettings = copy(settings) as any;
    inputSettings._ = 'inputPeerNotifySettings'; */

    return this.invokeAfterReset(() => {
      return this.apiManager.invokeApi('account.updateNotifySettings', {peer, settings});
    }).then(({stale}) => {
      // * else the reset undid it
      if(!stale) {
        this.generateLocalNotifySettingsUpdate(peer, settings);
      }
    });
  }

  /**
   * Changes some of a peer's own settings. `account.updateNotifySettings`
   * replaces every field, so the rest travel along — its own, never the global ones it inherits.
   * An `undefined` value drops the field
   */
  public async editNotifySettings(
    peer: InputNotifyPeer.inputNotifyPeer,
    edit: Partial<Omit<InputPeerNotifySettings, '_'>>,
    local?: boolean
  ): Promise<void> {
    // * read, merged and written with no Reset All on its way or gone through in between: across one, the fields it
    // * clears would travel along
    const {result: current, stale} = await this.invokeAfterReset(async() => this.getNotifySettings(peer));
    if(stale || this.resetting) {
      return this.editNotifySettings(peer, edit, local);
    }

    const settings: InputPeerNotifySettings = {
      ...current,
      _: 'inputPeerNotifySettings',
      // * sounds come back per platform, and this client's one is the `other` one (as in tdesktop)
      sound: current.other_sound,
      stories_sound: current.stories_other_sound
    };

    for(const key in edit) {
      const value = edit[key as keyof typeof edit];
      if(value === undefined) delete settings[key as keyof typeof edit];
      else (settings as any)[key] = value;
    }

    if(local) this.generateLocalNotifySettingsUpdate(peer, settings);
    else return this.updateNotifySettings(peer, settings);
  }

  /**
   * Back to the defaults everywhere: the server drops every chat's own settings and
   * resets the types', and whatever shows them is told so, as an update from the server would
   */
  public resetNotifySettings() {
    return this.resetting ??= this.performResetNotifySettings().finally(() => {
      this.resetting = undefined;
    });
  }

  /**
   * Every request of these settings: sent at once, or after a Reset All on its way, at the settings clock's tick it
   * is handed (`askedAt`). Its answer is `stale` when a Reset All went through while it was out: what it holds is gone
   * then
   */
  private async invokeAfterReset<T>(invoke: (askedAt: number) => Promise<T>) {
    while(this.resetting) {
      await this.resetting.catch(noop);
    }

    const askedAt = this.settingsClock;
    const result = await invoke(askedAt);
    return {result, askedAt, stale: this.settingsResetAt > askedAt};
  }

  /**
   * The settings clock's tick: read before asking the server for what holds a chat's settings (a full profile), and
   * handed to savePeerSettings with them, so that they do not overwrite what changed here since
   */
  public getSettingsClock() {
    return this.settingsClock;
  }

  /**
   * Whether what is kept under `clockKey` changed here, or a Reset All went through, after the tick `askedAt`: an
   * answer asked for then holds older settings than that
   */
  private isChangedSince(clockKey: string, askedAt: number) {
    return this.settingsResetAt > askedAt || this.settingsChangedAt.get(clockKey) > askedAt;
  }

  private async performResetNotifySettings() {
    await this.apiManager.invokeApi('account.resetNotifySettings');
    this.settingsResetAt = ++this.settingsClock;

    // * no list of exceptions follows the chats one by one: they are all empty at once below
    const exceptions = this.exceptions;
    this.exceptions = undefined;

    const ownKeys: OwnSettingsKey[] = ['notifyPeer'];
    for(const ownKey of ownKeys) {
      const container = this.peerSettings[ownKey];
      for(const key in container) {
        const settings = container[key];
        if(settings instanceof Promise) {
          delete container[key];
        } else if(Object.keys(settings).some((field) => field !== '_' && field !== 'flags')) {
          this.saveOwnSettingsUpdate(key, {_: 'peerNotifySettings'});
        }
      }
    }

    if(exceptions) {
      this.exceptions = {};
      for(const key in exceptions) {
        this.exceptions[key as GlobalNotifySettingsKey] = new Map();
        this.dispatchExceptions(key as GlobalNotifySettingsKey);
      }
    }

    // * the contact sign-up and reactions settings are asked for again rather than guessed
    this.notifyContactsSignUp = undefined;
    this.reactionsNotifySettings = undefined;

    // * the types' settings are asked for anew, and nothing of the old ones is kept meanwhile: should asking fail, the
    // * next read asks the server
    this.getNotifyPeerTypePromise = undefined;
    await Promise.all(NOTIFY_PEER_TYPES.map(async(inputKey) => {
      const key = convertInputKeyToKey<MyNotifyPeer>(inputKey);
      this.forgetTypeSettings(key);
      const askedAt = this.settingsClock;
      const settings = await this.apiManager.invokeApi('account.getNotifySettings', {peer: {_: inputKey}}).catch(noop);
      // * else a change pushed meanwhile is newer than the answer
      if(settings && !this.isChangedSince(getSettingsClockKey('type', key), askedAt)) {
        this.apiUpdatesManager.saveUpdate({_: 'updateNotifySettings', peer: {_: key}, notify_settings: settings});
      }
    }));

    this.rootScope.dispatchEvent('notify_settings_reset');
  }

  /**
   * The chats of a type with settings of their own (account.getNotifyExceptions), as tdesktop counts them: an own
   * `mute_until`. The list then follows every change of a chat's settings (`notify_exceptions`)
   */
  public getNotifyExceptions(inputKey: MyInputNotifyPeer): Promise<NotifyException[]> {
    return this.invokeAfterReset((askedAt) => this.apiManager.invokeApiSingleProcess({
      method: 'account.getNotifyExceptions',
      params: {peer: {_: inputKey}},
      // * a list asked for after Reset All never joins one asked for before it
      options: {cacheKey: inputKey + '_' + this.settingsResetAt},
      // * kept or not as it comes, as the chats' settings are saved with it
      processResult: (updates) => {
        // * a Reset All went through while it was asked: nothing of it is kept, and it is asked again below
        if(this.settingsResetAt > askedAt) {
          return;
        }

        const key = convertInputKeyToKey<GlobalNotifySettingsKey>(inputKey);
        this.exceptions ??= {};
        // * filled after the chats' settings are saved: saving them must not touch a list that is being replaced
        delete this.exceptions[key];

        const exceptions = new Map<PeerId, boolean>();
        const add = (peerId: PeerId, settings: PeerNotifySettings) => {
          // * the server may answer with chats of every type: each goes to its own type's list, as tdesktop's
          // * updateException sorts them
          const {_: peerInputKey} = this.appPeersManager.getInputNotifyPeerById({peerId, ignorePeerId: true});
          if(peerInputKey === inputKey && this.isNotifyException(peerId, settings)) {
            exceptions.set(peerId, this.isMuted(settings));
          }
        };

        // * a chat whose settings changed here since it was asked goes by what it has now, newest on top
        const peerClockKey = getSettingsClockKey('notifyPeer', '');
        const changed = [...this.settingsChangedAt]
        .filter(([clockKey, changedAt]) => changedAt > askedAt && clockKey.startsWith(peerClockKey))
        .sort(([, a], [, b]) => b - a);
        for(const [clockKey] of changed) {
          const peerId = clockKey.slice(peerClockKey.length).toPeerId();
          add(peerId, this.getPeerLocalSettings({peerId, respectType: false}));
        }

        if('updates' in updates) {
          this.appPeersManager.saveApiPeers(updates as Updates.updates);
          for(const update of (updates as Updates.updates).updates) {
            if(update._ !== 'updateNotifySettings' || update.peer._ !== 'notifyPeer') {
              continue;
            }

            // * kept as an update from the server would be, so the chat's dialog has them too, unless they changed
            // * here since
            const peerId = this.appPeersManager.getPeerId(update.peer.peer);
            if(!this.isChangedSince(getSettingsClockKey('notifyPeer', this.getPeerKey(peerId)), askedAt)) {
              this.apiUpdatesManager.saveUpdate(update);
              add(peerId, update.notify_settings);
            }
          }
        }

        this.exceptions[key] = exceptions;
        return this.getExceptionsList(key);
      }
    })).then(({result, stale}) => {
      // * also when it was kept just before the reset went through, which emptied the list since
      return stale ? this.getNotifyExceptions(inputKey) : result;
    });
  }

  /**
   * Drops the chats' own settings, so that they follow their type's again
   */
  public resetPeersNotifySettings(peerIds: PeerId[]) {
    return Promise.all(peerIds.map((peerId) => {
      return this.updateNotifySettings(
        this.appPeersManager.getInputNotifyPeerById({peerId}),
        {_: 'inputPeerNotifySettings'}
      );
    }));
  }

  private getExceptionsList(key: GlobalNotifySettingsKey): NotifyException[] {
    return [...this.exceptions[key]].map(([peerId, muted]) => ({peerId, muted}));
  }

  private dispatchExceptions(key: GlobalNotifySettingsKey) {
    this.rootScope.dispatchEvent('notify_exceptions', {key, exceptions: this.getExceptionsList(key)});
  }

  // * tdesktop's SkipAddException: nobody can change the settings of a chat that is gone, nor of one's own
  private isNotifyException(peerId: PeerId, settings: PeerNotifySettings) {
    if(settings.mute_until === undefined || peerId === this.appPeersManager.peerId) {
      return false;
    }

    if(peerId.isUser()) {
      const user = this.appUsersManager.getUser(peerId.toUserId());
      return !!user && !user.pFlags.deleted;
    }

    const chat = this.appChatsManager.getChat(peerId.toChatId());
    return !!chat &&
      chat._ !== 'chatForbidden' &&
      chat._ !== 'channelForbidden' &&
      !(chat as Chat.chat).pFlags.deactivated;
  }

  private updateException(peerId: PeerId, settings: PeerNotifySettings) {
    if(!this.exceptions) {
      return;
    }

    const {_: inputKey} = this.appPeersManager.getInputNotifyPeerById({peerId, ignorePeerId: true});
    const key = convertInputKeyToKey<GlobalNotifySettingsKey>(inputKey);
    const exceptions = this.exceptions[key];
    if(!exceptions) {
      return;
    }

    const isException = this.isNotifyException(peerId, settings);
    const muted = isException && this.isMuted(settings);
    if(isException ? exceptions.get(peerId) === muted : !exceptions.has(peerId)) {
      return;
    }

    if(!isException) exceptions.delete(peerId);
    else if(exceptions.has(peerId)) exceptions.set(peerId, muted);
    // * a new one goes on top, as in tdesktop
    else this.exceptions[key] = new Map([[peerId, muted], ...exceptions]);

    this.dispatchExceptions(key);
  }

  /**
   * Whether this client stays silent for a chat: its own choice, else what it inherits (its type's). This client's
   * sound is the `other` one, as in tdesktop
   */
  public isPeerLocalSoundOff(options: {peerId: PeerId}) {
    if(!(options = this.validatePeerSettings(options))) return false;

    const sound = this.getPeerLocalSettings({peerId: options.peerId}).other_sound;
    return sound?._ === 'notificationSoundNone';
  }

  public getContactSignUpNotification(): Promise<boolean> {
    if(this.notifyContactsSignUp) return this.notifyContactsSignUp;
    const promise: Promise<boolean> = this.notifyContactsSignUp = this.invokeAfterReset(() => {
      return this.apiManager.invokeApi('account.getContactSignUpNotification');
    }).then(({result: silent, stale}) => {
      if(!stale) {
        return !silent;
      }

      if(this.notifyContactsSignUp === promise) this.notifyContactsSignUp = undefined;
      return this.getContactSignUpNotification();
    });

    return promise;
  }

  public setContactSignUpNotification(silent: boolean) {
    this.invokeAfterReset(() => {
      return this.apiManager.invokeApi('account.setContactSignUpNotification', {silent});
    }).then(({stale}) => {
      // * else whatever the reset left is asked for
      if(!stale) {
        this.notifyContactsSignUp = Promise.resolve(!silent);
      }
    });
  }

  public getReactionsNotifySettings(): Promise<ReactionsNotifySettings> | ReactionsNotifySettings {
    if(this.reactionsNotifySettings) return this.reactionsNotifySettings;
    const promise: Promise<ReactionsNotifySettings> = this.reactionsNotifySettings = this.invokeAfterReset(() => {
      return this.apiManager.invokeApi('account.getReactionsNotifySettings');
    }).then(({result: settings, askedAt}) => {
      if(!this.isChangedSince(REACTIONS_CLOCK_KEY, askedAt)) {
        return this.reactionsNotifySettings = settings;
      }

      // * a Reset All went through, or they were changed here, while they were asked: what there is now
      if(this.reactionsNotifySettings === promise) this.reactionsNotifySettings = undefined;
      return this.getReactionsNotifySettings();
    });

    return promise;
  }

  // * whether a reaction to our own story from this peer should be notified about,
  // * and whether it may reveal who reacted with what
  public async getStoryReactionNotifySettings(fromPeerId: PeerId) {
    const settings = await this.getReactionsNotifySettings();
    const from = settings?.stories_notify_from;
    if(!from) {
      return;
    }

    if(
      from._ === 'reactionNotificationsFromContacts' &&
      !(fromPeerId.isUser() && this.appUsersManager.isContact(fromPeerId.toUserId()))
    ) {
      return;
    }

    return {showPreview: settings.show_previews};
  }

  public setReactionsNotifySettings(settings: ReactionsNotifySettings) {
    this.reactionsNotifySettings = settings;
    this.settingsChangedAt.set(REACTIONS_CLOCK_KEY, ++this.settingsClock);
    return this.invokeAfterReset(() => {
      return this.apiManager.invokeApi('account.setReactionsNotifySettings', {settings});
    }).then(({result, askedAt}) => {
      if(!this.isChangedSince(REACTIONS_CLOCK_KEY, askedAt)) {
        return this.reactionsNotifySettings = result;
      }

      // * a Reset All undid it, or a newer change went out since: what there is now
      if(this.reactionsNotifySettings === settings) this.reactionsNotifySettings = undefined;
      return this.getReactionsNotifySettings();
    });
  }

  private checkMuteUntil = () => {
    if(this.checkMuteUntilTimeout !== undefined) {
      clearTimeout(this.checkMuteUntilTimeout);
      this.checkMuteUntilTimeout = undefined;
    }

    const timestamp = tsNow(true);
    let closestMuteUntil = MUTE_UNTIL;

    const p = (peerNotifySettings: ImSadAboutIt): peerNotifySettings is PeerNotifySettings => {
      if(peerNotifySettings instanceof Promise) {
        return false;
      }

      const muteUntil = peerNotifySettings.mute_until;
      if(!muteUntil) {
        return false;
      }

      if(muteUntil <= timestamp) {
        // ! do not delete it because peer's unique settings will be overwritten in getPeerLocalSettings with type's settings
        peerNotifySettings.mute_until = 0;
        return true;
      } else if(muteUntil < closestMuteUntil) {
        closestMuteUntil = muteUntil;
      }

      return false;
    };

    const ownKeys: OwnSettingsKey[] = ['notifyPeer'];
    for(const ownKey of ownKeys) {
      for(const key in this.peerSettings[ownKey]) {
        const peerNotifySettings = this.peerSettings[ownKey][key];
        if(p(peerNotifySettings)) {
          this.saveOwnSettingsUpdate(key, peerNotifySettings);
        }
      }
    }

    const timeout = Math.min(1800e3, (closestMuteUntil - timestamp) * 1000);
    this.checkMuteUntilTimeout = ctx.setTimeout(this.checkMuteUntil, timeout);
  };

  /**
   * Hands a chat's own settings out as an update from the server would, by the key they are kept under (`peerId`)
   */
  private saveOwnSettingsUpdate(key: string, settings: PeerNotifySettings) {
    const peer: NotifyPeer = {_: 'notifyPeer', peer: this.appPeersManager.getOutputPeer(key.toPeerId())};

    this.apiUpdatesManager.saveUpdate({_: 'updateNotifySettings', peer, notify_settings: settings});
  }

  public getPeerKey(peerId: PeerId) {
    return '' + peerId;
  }

  /**
   * Drops what is kept of a type's settings, here and for the next start: the next read asks the server
   */
  private forgetTypeSettings(key: MyNotifyPeer) {
    this.peerSettings[key] = undefined;
    this.appStateManager.getState().then((state) => {
      delete state.notifySettings[key];
      this.appStateManager.pushToState('notifySettings', state.notifySettings);
    });
  }

  /**
   * Keeps settings, and gives what is kept now: settings that come with an answer asked for at the settings clock's
   * `askedAt` are older than a change of them made here since, or than a Reset All gone through since, and are not
   * kept then (what was is given, or none of their own). Without `askedAt` they are always kept; with `changed` they
   * are such a change themselves
   */
  public savePeerSettings({key, peerId, settings, askedAt, changed}: {
    key?: MyNotifyPeer,
    peerId?: PeerId,
    settings: PeerNotifySettings,
    askedAt?: number,
    changed?: boolean
  }): PeerNotifySettings {
    let obj: any;
    let kind: Parameters<typeof getSettingsClockKey>[0] = 'type';
    if(peerId) {
      key = this.getPeerKey(peerId) as any;
      kind = 'notifyPeer';
      obj = this.peerSettings[kind];
    }

    const clockKey = getSettingsClockKey(kind, key);
    if(askedAt !== undefined && this.isChangedSince(clockKey, askedAt)) {
      const kept = (obj || this.peerSettings)[key];
      return kept && !(kept instanceof Promise) ? kept : {_: 'peerNotifySettings'};
    }

    if(changed) {
      this.settingsChangedAt.set(clockKey, ++this.settingsClock);
    }

    (obj || this.peerSettings)[key] = settings;

    if(!peerId) {
      this.rootScope.dispatchEvent('notify_peer_type_settings', {key, settings});
      this.appStateManager.getState().then((state) => {
        const notifySettings = state.notifySettings;
        notifySettings[key] = settings;
        this.appStateManager.pushToState('notifySettings', notifySettings);
      });
    } else {
      this.checkMuteUntilThrottled();
      this.updateException(peerId, settings);
    }

    // rootScope.broadcast('notify_settings', {peerId: peerId});
    return settings;
  }

  public isMuted(peerNotifySettings: PeerNotifySettings) {
    return peerNotifySettings._ === 'peerNotifySettings' &&
      (peerNotifySettings.silent || (peerNotifySettings.mute_until !== undefined && (peerNotifySettings.mute_until * 1000) > tsNow()));
  }

  private getPeerMuted(peerId: PeerId) {
    const ret = this.getNotifySettings({_: 'inputNotifyPeer', peer: this.appPeersManager.getInputPeerById(peerId)});
    return (ret instanceof Promise ? ret : Promise.resolve(ret))
    .then((peerNotifySettings) => this.isMuted(peerNotifySettings));
  }

  private getPeerLocalSettings({
    peerId,
    respectType = true
  }: {
    peerId: PeerId,
    respectType?: boolean
  }): PeerNotifySettings {
    const n: PeerNotifySettings = {
      _: 'peerNotifySettings'
    };

    const notifySettings = this.peerSettings.notifyPeer[this.getPeerKey(peerId)];
    // if(!notifySettings || (notifySettings instanceof Promise)) return false;
    if(notifySettings && !(notifySettings instanceof Promise)) {
      Object.assign(n, notifySettings);
    }

    if(respectType) {
      const applyFallback = (settings: ImSadAboutIt) => {
        if(!settings || settings instanceof Promise) {
          return;
        }

        for(const i in settings) {
          // @ts-ignore
          if(n[i] === undefined) {
            // @ts-ignore
            n[i] = settings[i];
          }
        }
      };

      const inputNotify = this.appPeersManager.getInputNotifyPeerById({peerId, ignorePeerId: true});
      const key = convertInputKeyToKey(inputNotify._);
      applyFallback(this.peerSettings[key as MyNotifyPeer]);
    }

    return n;
  }

  public validatePeerSettings<T extends Parameters<AppNotificationsManager['getPeerLocalSettings']>[0]>(options: T): T {
    if(options.peerId === this.appPeersManager.peerId) return;
    return options;
  }

  public isPeerLocalMuted(options: Parameters<AppNotificationsManager['getPeerLocalSettings']>[0]): boolean {
    if(!(options = this.validatePeerSettings(options))) return false;

    const notifySettings = this.getPeerLocalSettings(options);
    const isMuted = this.isMuted(notifySettings);
    return isMuted;
  }

  /**
   * Resolved the way iOS and Android do it: the peer's own choice, then the private chats one (the only global stories setting, whatever the peer is).
   * With none set, the server default ("Important Stories"), only the top 5 correspondents notify
   */
  public async isPeerStoriesMuted(peerId: PeerId) {
    const [usersSettings, peerSettings] = await Promise.all([
      this.getNotifySettings({_: 'inputNotifyUsers'}),
      this.getNotifySettings({_: 'inputNotifyPeer', peer: this.appPeersManager.getInputPeerById(peerId)})
    ]);

    const muted = peerSettings?.stories_muted ?? usersSettings?.stories_muted;
    if(muted !== undefined) {
      return muted;
    }

    const topPeers = await this.appUsersManager.getTopPeers('correspondents').catch((): MyTopPeer[] => []);
    return !topPeers.slice(0, 5).some((topPeer) => topPeer.id === peerId);
  }

  /**
   * `muted: undefined` hands the choice back to the default, as the server does when the peer's
   * stories are shown again
   */
  public toggleStoriesMute(peerId: PeerId, muted: boolean | undefined, local?: boolean) {
    return this.editNotifySettings({
      _: 'inputNotifyPeer',
      peer: this.appPeersManager.getInputPeerById(peerId)
    }, {stories_muted: muted}, local);
  }

  // * picks the single tab that should render a local notification for this peer,
  // * mirroring how message notifications are routed (see notifyAboutMessage)
  public async getNotificationTab(peerId: PeerId) {
    const settings = await commonStateStorage.get('settings', false);

    let tabs = appTabsManager.getTabs();
    if(!settings.notifyAllAccounts)
      tabs = tabs.filter((tab) => tab.state.accountNumber === this.getAccountNumber());

    tabs.sort((a, b) => a.state.idleStartTime - b.state.idleStartTime);

    let tab = tabs.find((tab) => {
      const {chatPeerIds, accountNumber} = tab.state;
      return accountNumber === this.getAccountNumber() && chatPeerIds[chatPeerIds.length - 1] === peerId;
    });

    if(!tab) {
      tab = tabs.find((tab) => tab.state.accountNumber === this.getAccountNumber());
    }

    if(!tab && tabs.length) {
      tab = !tabs[0].state.idleStartTime ? tabs[0] : tabs[tabs.length - 1];
    }

    return tab;
  }

  /**
   * Hand a built notification to the tab that should show it. Drops it when it belongs to the
   * first difference after the app start and somebody is sitting in that very tab: that
   * difference replays the whole backlog at once, and the unread badges tell the same story
   * without a popup per chat.
   */
  public async routeNotification(
    peerId: PeerId,
    payload: NotificationBuildPayload,
    isInitialSync = this.apiUpdatesManager.isInitialSync()
  ) {
    if(await this.appPeersManager.isPeerRestricted(peerId)) {
      return;
    }

    const tab = await this.getNotificationTab(peerId);
    // * no tab may show it: notifications of all accounts are off, and none shows this one. Posted to no tab in
    // * particular, it would go to every tab there is - each playing the sound and showing it
    if(!tab) {
      return;
    }

    // * the tab that would show it is idle -> the user is elsewhere (another tab, another window)
    const isOtherTabActive = !!tab.state.idleStartTime;
    if(!isOtherTabActive && isInitialSync) {
      return;
    }

    const port = MTProtoMessagePort.getInstance<false>();
    port.invokeVoid('notificationBuild', {
      ...payload,
      accountNumber: this.getAccountNumber(),
      isOtherTabActive
    } as NotificationBuildTaskPayload, tab.source);
  }

  private onUpdateNotifySettings = (update: Update.updateNotifySettings) => {
    const {peer} = update;
    // * Signal has no communities and no forum topics
    if(peer._ === 'notifyCommunity' || peer._ === 'notifyForumTopic') {
      return;
    }

    const isPeerType = peer._ === 'notifyPeer';
    const peerId = isPeerType && this.appPeersManager.getPeerId(peer.peer);
    const key = !isPeerType ? peer._ : undefined;
    this.savePeerSettings({
      key,
      peerId,
      settings: update.notify_settings,
      // * a local edit (processLocalUpdate) or one the server pushes: newer than any answer still out
      changed: true
    });
    this.rootScope.dispatchEvent('notify_settings', update);
  };
}
