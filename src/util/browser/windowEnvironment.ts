import {
  IS_TEST, SVG_NAMESPACE, VIDEO_RECORDING_MIME_TYPE,
} from '../../config';
import { requestForcedReflow, requestMutation } from '../../lib/fasterdom/fasterdom.ts';
import { IS_TAURI } from './globalEnvironment';
import { IS_ANDROID, IS_IOS, IS_MAC_OS, PLATFORM_ENV } from './platform';

const MIN_CHROMIUM_TUCK_VERSION = 149;
const CHROMIUM_VERSION = Number(
  navigator.userAgentData?.brands.find((data) => data.brand === 'Chromium')?.version
  ?? navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/)?.[1],
);

export {
  getPlatform, IS_ANDROID, IS_IOS, IS_LINUX, IS_MAC_OS, IS_WINDOWS, PLATFORM_ENV,
} from './platform';

export const IS_MOBILE = IS_IOS || IS_ANDROID;
export const IS_CHROMIUM = navigator.userAgentData?.brands.some((data) => data.brand === 'Chromium')
  || /Chrom(e|ium)\//.test(navigator.userAgent);
export const IS_SAFARI = !IS_CHROMIUM && /applewebkit/i.test(navigator.userAgent);
export const IS_YA_BROWSER = navigator.userAgent.includes('YaBrowser');
export const IS_FIREFOX = navigator.userAgent.toLowerCase().includes('firefox')
  || navigator.userAgent.toLowerCase().includes('iceweasel')
  || navigator.userAgent.toLowerCase().includes('icecat');

export const MouseButton = {
  Main: 0,
  Auxiliary: 1,
  Secondary: 2,
  Fourth: 3,
  Fifth: 4,
};

export const IS_PWA = (
  window.matchMedia('(display-mode: standalone)').matches
  || (window.navigator as any).standalone
  || document.referrer.includes('android-app://')
);

export const IS_APP = IS_PWA || IS_TAURI;

export const IS_TOUCH_ENV = window.matchMedia('(pointer: coarse)').matches;
export const IS_VOICE_RECORDING_SUPPORTED = Boolean(
  window.navigator.mediaDevices && 'getUserMedia' in window.navigator.mediaDevices && (
    window.AudioContext || (window as any).webkitAudioContext
  ),
);
export const IS_VIDEO_RECORDING_SUPPORTED = Boolean(
  window.navigator.mediaDevices && 'getUserMedia' in window.navigator.mediaDevices
  && typeof MediaRecorder !== 'undefined'
  && 'captureStream' in HTMLCanvasElement.prototype
  // WebKit (Safari and all iOS browsers) canvas.captureStream produces invalid frames / can hang on stop
  && !IS_SAFARI && !IS_IOS
  && (MediaRecorder.isTypeSupported(VIDEO_RECORDING_MIME_TYPE)
    || MediaRecorder.isTypeSupported('video/mp4')),
);
export const IS_EMOJI_SUPPORTED = PLATFORM_ENV && (IS_MAC_OS || IS_IOS) && isLastEmojiVersionSupported();

// The desktop app serves its bundle from `tauri://localhost` or, on Windows, `http://tauri.localhost`; the system
// webviews run service workers only for network origins
const IS_TAURI_BUNDLE = IS_TAURI
  && (window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost');
export const IS_SERVICE_WORKER_SUPPORTED = 'serviceWorker' in navigator && !IS_TAURI_BUNDLE;

// TODO Consider failed service worker
export const IS_PROGRESSIVE_SUPPORTED = IS_SERVICE_WORKER_SUPPORTED;
export const IS_OPUS_SUPPORTED = Boolean((new Audio()).canPlayType('audio/ogg; codecs=opus'));
export const IS_CANVAS_FILTER_SUPPORTED = (
  !IS_TEST && 'filter' in (document.createElement('canvas').getContext('2d') || {})
);
export const IS_REQUEST_FULLSCREEN_SUPPORTED = 'requestFullscreen' in document.createElement('div');
export const IS_DOCUMENT_PICTURE_IN_PICTURE_SUPPORTED = Boolean(window.documentPictureInPicture?.requestWindow);

export const IS_WAVE_TRANSFORM_SUPPORTED = !IS_MOBILE
  && !IS_FIREFOX // https://bugzilla.mozilla.org/show_bug.cgi?id=1961378
  && !IS_SAFARI; // https://bugs.webkit.org/show_bug.cgi?id=245510
export const IS_TUCK_SUPPORTED = !IS_MOBILE && !IS_SAFARI
  // Older Chromium resolves primitive percentages against the definition's viewport
  // https://crbug.com/473562220
  && (!IS_CHROMIUM || CHROMIUM_VERSION >= MIN_CHROMIUM_TUCK_VERSION);
export const IS_SVG_CALC_SUPPORTED = checkSvgFilterCalcSupport();
export const IS_FLUID_BACKGROUND_SUPPORTED = !IS_FIREFOX;

const TEST_VIDEO = document.createElement('video');

export const IS_WEBM_SUPPORTED = Boolean(TEST_VIDEO.canPlayType('video/webm; codecs="vp9"').replace('no', ''));

export const MASK_IMAGE_DISABLED = true;
export const IS_OPFS_SUPPORTED = Boolean(navigator.storage?.getDirectory);
if (IS_OPFS_SUPPORTED) {
  // Clear old contents
  (async () => {
    try {
      const directory = await navigator.storage.getDirectory();
      await directory.removeEntry('downloads', { recursive: true });
    } catch {
      // Ignore
    }
  })();
}

export const IS_OFFSET_PATH_SUPPORTED = CSS.supports('offset-rotate: 0deg');
export const IS_BACKDROP_BLUR_SUPPORTED = CSS.supports('backdrop-filter: blur()')
  || CSS.supports('-webkit-backdrop-filter: blur()');
export const IS_INSTALL_PROMPT_SUPPORTED = 'onbeforeinstallprompt' in window;
export const IS_OPEN_IN_NEW_TAB_SUPPORTED = !(IS_PWA && IS_MOBILE);
export const IS_VIEW_TRANSITION_SUPPORTED = CSS.supports('view-transition-class: test')
  && !IS_FIREFOX; // https://bugzilla.mozilla.org/show_bug.cgi?id=1994547
export const IS_WEBAUTHN_SUPPORTED = navigator.credentials && window.PublicKeyCredential
  && 'parseCreationOptionsFromJSON' in PublicKeyCredential;
export const IS_WEBAUTHN_SIGNAL_API_SUPPORTED = IS_WEBAUTHN_SUPPORTED
  && 'signalUnknownCredential' in PublicKeyCredential;

export const MESSAGE_LIST_SENSITIVE_AREA = 750;

export function setScrollbarWidthProperty() {
  const el = document.createElement('div');
  el.style.cssText = 'overflow-x: hidden; overflow-y: scroll; visibility:hidden; position:absolute;';
  el.classList.add('custom-scroll');

  requestMutation(() => {
    document.body.appendChild(el);

    requestForcedReflow(() => {
      const width = el.offsetWidth - el.clientWidth;

      return () => {
        document.documentElement.style.setProperty('--scrollbar-width', `${width}px`);
        el.remove();
      };
    });
  });
}

export const MAX_BUFFER_SIZE = (IS_MOBILE ? 512 : 2000) * 1024 ** 2; // 512 OR 2000 MB

function isLastEmojiVersionSupported() {
  const ALLOWABLE_CALCULATION_ERROR_SIZE = 5;
  const inlineEl = document.createElement('span');
  inlineEl.classList.add('emoji-test-element');
  document.body.appendChild(inlineEl);

  inlineEl.innerText = '🧑‍🩰'; // Emoji from 17.0 version
  const newEmojiWidth = inlineEl.offsetWidth;
  inlineEl.innerText = '❤️'; // Emoji from 1.0 version
  const legacyEmojiWidth = inlineEl.offsetWidth;

  document.body.removeChild(inlineEl);

  return Math.abs(newEmojiWidth - legacyEmojiWidth) < ALLOWABLE_CALCULATION_ERROR_SIZE;
}

function checkSvgFilterCalcSupport() {
  const SVG_FILTER_CALC_TEST_VALUE = 'calc(100% - 1px)';

  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  const filter = document.createElementNS(SVG_NAMESPACE, 'filter');
  const testPrimitive = document.createElementNS(SVG_NAMESPACE, 'feFlood');

  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  testPrimitive.setAttribute('y', SVG_FILTER_CALC_TEST_VALUE);
  filter.appendChild(testPrimitive);
  svg.appendChild(filter);

  try {
    document.body.appendChild(svg);
    return testPrimitive.y.baseVal.valueAsString === SVG_FILTER_CALC_TEST_VALUE;
  } catch {
    return false;
  } finally {
    svg.remove();
  }
}
