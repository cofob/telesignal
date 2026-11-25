/*
 * Originally from:
 * https://github.com/zhukov/webogram
 * Copyright (C) 2014 Igor Zhukov <igor.beatle@gmail.com>
 * https://github.com/zhukov/webogram/blob/master/LICENSE
 */

import type {TrueDcId} from '@types';
import {BASE_DC_ID} from '@lib/accounts/authKeyFingerprint';

export const MAIN_DOMAINS = ['web.telegram-org.invalid', 'webk.telegram-org.invalid'];
export const DEFAULT_BACKGROUND_SLUG = 'pattern';

const threads = Math.min(4, navigator.hardwareConcurrency ?? 4);

const App = {
  id: +import.meta.env.VITE_API_ID,
  hash: import.meta.env.VITE_API_HASH,
  version: import.meta.env.VITE_VERSION,
  versionFull: import.meta.env.VITE_VERSION_FULL,
  build: +import.meta.env.VITE_BUILD,
  langPackVersion: +import.meta.env.VITE_LANG_PACK_VERSION,
  langPack: 'webk',
  langPackCode: 'en',
  domains: MAIN_DOMAINS,
  baseDcId: BASE_DC_ID as TrueDcId,
  isMainDomain: MAIN_DOMAINS.includes(location.hostname),
  suffix: 'K',
  threads,
  lottieWorkers: threads,
  // * one crypto worker: its work (storage encryption, sticker unpacking, hashes) has no parallel stream
  cryptoWorkers: 1,
  interclientBroadcastChannel: 'tgweb'
};

// * "TeleSignal K 0.1.0" - how the app names itself, in the main menu and under Settings
export function getAppVersionText() {
  return `TeleSignal ${App.suffix} ${App.version}`;
}

if(App.isMainDomain) { // use Webogram credentials then
  App.id = 2496;
  App.hash = '8da85b0d5bfe62527e5b244c209159c3';
}

export default App;
