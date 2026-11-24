import wrapUrl, {getAnchorHandlerName, isAnchorHandlerName} from '@lib/richTextProcessor/wrapUrl';
import matchTelegramUrlHost from '@lib/richTextProcessor/matchTelegramUrlHost';
import cancelEvent from '@helpers/dom/cancelEvent';
import parseUriParams from '@helpers/string/parseUriParams';
import {toastNew} from '@components/toast';

// * https://core.telegram.org/api/links

type InternalLinkAnchorType =
  | 'showMaskedAlert'
  | 'execBotCommand'
  | 'searchByHashtag'
  | 'addstickers'
  | 'im'
  | 'resolve'
  | 'privatepost'
  | 'voicechat'
  | 'call'
  | 'joinchat'
  | 'join'
  | 'invoice'
  | 'addemoji'
  | 'setMediaTimestamp'
  | 'addlist'
  | 'boost'
  | 'premium_offer'
  | 'giftcode'
  | 'm'
  | 'message'
  | 'stars_topup'
  | 'share'
  | 'msg_url'
  | 'nft'
  | 'iv'
  | 'new'
  | 'settings'
  | 'contacts'
  | 'chats'
  | 'addstyle'
  | 'contact'
  | 'proxy'
  | 'socks'
  | 'unknownDeepLink'
  | 'transfer'
  | 'ton-connect'
  | 'tonconnect'
  | 'signal_link'
;

export const UNSAFE_ANCHOR_LINK_TYPES: Set<InternalLinkAnchorType> = new Set([
  'showMaskedAlert',
  'execBotCommand'
]);

export default function addAnchorListener<
  Params extends {
    pathnameParams?: any,
    uriParams?: any
  }
>(options: {
  name: InternalLinkAnchorType,
  protocol?: 'tg' | 'ton' | 'tc',
  callback: (params: Params & {element?: HTMLAnchorElement, masked?: boolean, event?: Event}) => any,
  noPathnameParams?: boolean,
  noUriParams?: boolean,
  noCancelEvent?: boolean
}) {
  const handlerName = getAnchorHandlerName(options.name, options.protocol);
  if(!isAnchorHandlerName(handlerName)) {
    throw new Error(`a link handler is called by its name from an anchor's onclick, which ${handlerName} cannot be`);
  }

  (window as any)[handlerName] = (element?: HTMLAnchorElement, e?: Event) => {
    !options.noCancelEvent && cancelEvent(null);

    let href = element.href;
    if(!href) {
      return;
    }

    let pathnameParams: any[];
    let uriParams: any;

    const u = new URL(href);
    const match = matchTelegramUrlHost(u);
    if(match?.prefix) {
      u.pathname = match.prefix + (u.pathname === '/' ? '' : u.pathname);
      href = u.toString();
    }

    if(!options.noPathnameParams) pathnameParams = new URL(href).pathname.split('/').slice(1);
    if(!options.noUriParams) uriParams = parseUriParams(href);

    const masked = element.href !== wrapUrl(element.textContent).url && element.getAttribute('safe') === null;
    const result = options.callback({
      ...{pathnameParams, uriParams} as Params,
      element,
      masked,
      event: e || window.event
    });

    if(!e?.isTrusted) {
      return result;
    }
  };
}

const MIDDLE_BUTTON = 1;

/** The handler's name, spelled by either carrier: an inline `onclick`, or a web-page box's dataset. */
function getAnchorCallbackName(anchor: HTMLAnchorElement) {
  const fromDataset = anchor.dataset.callback;
  if(fromDataset) {
    return fromDataset;
  }

  const onclick = anchor.getAttribute('onclick'); // `showMaskedAlert(this)`
  const index = onclick ? onclick.indexOf('(') : -1;
  return index > 0 ? onclick.slice(0, index) : undefined;
}

/**
 * A masked link asks before it opens, and that question hangs off the anchor's `onclick` — which
 * the browser fires for the primary button alone. A middle click went around it and opened the
 * real host in a new tab, i.e. exactly the navigation the alert is there to hold back, so it is
 * answered with the same alert. The remaining ways past it (the native context menu, dragging
 * the link out) belong to the browser and cannot be taken back from it.
 */
function onMaskedAnchorAuxClick(e: MouseEvent) {
  if(e.button !== MIDDLE_BUTTON || e.defaultPrevented) {
    return false;
  }

  // the innermost anchor, not the innermost MASKED one: a plain link nested in a masked web-page
  // box carries its own destination, and the box's alert would name a url nobody clicked
  const anchor = (e.target as Element)?.closest?.('a');
  if(!anchor?.href || getAnchorCallbackName(anchor) !== 'showMaskedAlert') {
    return false;
  }

  const showMaskedAlert = (window as any).showMaskedAlert;
  if(!showMaskedAlert) {
    return false;
  }

  cancelEvent(e);
  showMaskedAlert(anchor, e);
  return true;
}

/**
 * TeleSignal: what a link of a message, a caption or a link preview may do here. Everything else that Web K's
 * Telegram links did (`t.me` and `tg:` links, bot commands, bank cards) acts on a click without asking, such as
 * looking up a phone number, so it is not opened: the link says it is not supported.
 */
const CONTENT_ANCHOR_HANDLERS: Set<string> = new Set(['signal_link', 'showMaskedAlert', 'searchByHashtag', 'setMediaTimestamp']);

/** Runs the handler that a link of content names, if it is one that content may run (`CONTENT_ANCHOR_HANDLERS`) */
export function runContentAnchorHandler(name: string, anchor: HTMLElement, e: Event) {
  const handler = CONTENT_ANCHOR_HANDLERS.has(name) && Object.prototype.hasOwnProperty.call(window, name) ?
    (window as any)[name] :
    undefined;
  if(typeof(handler) !== 'function') {
    cancelEvent(e);
    toastNew({langPackKey: 'Link.NotSupported'});
    return;
  }

  return handler(anchor, e);
}

/**
 * TeleSignal: the app's content security policy (`buildCsp`) allows no inline scripts, so the browser never runs an
 * anchor's inline `onclick`: a click on such a link runs the handler it names from here, if content may run it. An
 * inline handler that a policy did allow cancels the click first, and this one then leaves it alone.
 */
function onAnchorClick(e: MouseEvent) {
  if(e.defaultPrevented || e.button !== 0) {
    return;
  }

  const anchor = (e.target as Element)?.closest?.('a[onclick]') as HTMLAnchorElement;
  const name = anchor && getAnchorCallbackName(anchor);
  if(name) {
    runContentAnchorHandler(name, anchor, e);
  }
}

let listeningForAnchorClicks = false;
export function listenForAnchorClicks() {
  if(listeningForAnchorClicks) {
    return;
  }

  listeningForAnchorClicks = true;
  document.addEventListener('click', onAnchorClick);
}

let listeningForMaskedAnchorAuxClicks = false;
export function listenForMaskedAnchorAuxClicks() {
  if(listeningForMaskedAnchorAuxClicks) {
    return;
  }

  listeningForMaskedAnchorAuxClicks = true;
  // bubble phase on purpose: a capture-phase guard closer to the content (hidden links inside
  // bubbles, the read-only preview chat) gets to swallow the click before this one sees it
  document.addEventListener('auxclick', onMaskedAnchorAuxClick);
}
