/*
 * TeleSignal: the desktop app's native transport for the Signal engine of this worker. The engine sends `TlsTunnel`
 * bytes over TCP that the app opens (`tauri/src/transport.rs`), but only a page can call the app, so each page of the
 * app offers its end of a channel (`serveNativeTransport` of `src/util/tauri/serveNativeTransport.ts`), and one of
 * them serves the engine at a time. The engine keeps one port for its whole run (`src/lib/signal/net/NativeTransport.ts`),
 * so this module sits between that port and the serving page.
 *
 * The app ends the connections of a page that closes or reloads, and that page can no longer report it. When the
 * serving page leaves, every open connection therefore closes for the engine, which reconnects through the next page
 * that offered a port; with no page left, connections close as they are asked for. The serving page stays until it
 * leaves, so a new tab does not interrupt the connections that run.
 *
 * In a production build the provider's chunk imports this worker's entry chunk by a URL without the entry's query,
 * which evaluates a second copy of the entry and of this module (`FRICTION_LOG.md`). The relay therefore lives on the
 * worker's global scope, which both copies share, and the engine's module is imported dynamically, as the provider is,
 * so that the port reaches the copy that the engine uses.
 */

import type {NativeTransportEvent, NativeTransportRequest} from '@signal-app/native-transport';

type Relay = {
  // * the ports that the pages offered, oldest first, by the page
  offeredPorts: Map<MessageEventSource, MessagePort>,
  servingSource?: MessageEventSource,
  enginePort?: MessagePort,
  settingEnginePort?: Promise<void>,
  // * the connections that the engine opened and that have not closed, by the engine's id
  openIds: Set<number>
};

const RELAY_KEY = '__signalNativeTransportRelay';
const PAGE_CLOSED_REASON = 'The page that served the connection closed';
const NO_PAGE_REASON = 'No page serves the native transport';

const relay: Relay = (globalThis as any)[RELAY_KEY] ??= {offeredPorts: new Map(), openIds: new Set()};

/** Takes a page's end of the native transport; the first one also tells the engine that the app connects natively */
export function offerNativeTransportPort(source: MessageEventSource, port: MessagePort) {
  // * both copies of the entry take the same message
  if(relay.offeredPorts.get(source) === port) {
    return;
  }

  releaseNativeTransportSource(source);
  relay.offeredPorts.set(source, port);

  if(!relay.enginePort) {
    const channel = new MessageChannel();
    relay.enginePort = channel.port1;
    relay.enginePort.onmessage = handleEngineRequest;
    relay.settingEnginePort = import('@signal-app/native-transport').then(({setNativeTransportPort}) => {
      setNativeTransportPort(channel.port2);
    });
  }

  if(!relay.servingSource) {
    serveFrom(source);
  }
}

/**
 * Settles once the engine has the port, when a page of the app offered one. A page's offer comes before its request to
 * start the engine, so the engine that waits for this connects natively from its first connection.
 */
export function waitForNativeTransport() {
  return relay.settingEnginePort;
}

/** Forgets a page that closed; when it served the engine, its connections close and the next page serves */
export function releaseNativeTransportSource(source: MessageEventSource) {
  const port = relay.offeredPorts.get(source);
  if(!port) {
    return;
  }

  relay.offeredPorts.delete(source);
  port.close();
  if(relay.servingSource !== source) {
    return;
  }

  relay.servingSource = undefined;
  relay.openIds.forEach((id) => postToEngine({type: 'closed', id, reason: PAGE_CLOSED_REASON}));
  relay.openIds.clear();

  const nextSource = relay.offeredPorts.keys().next().value;
  if(nextSource) {
    serveFrom(nextSource);
  }
}

function serveFrom(source: MessageEventSource) {
  relay.servingSource = source;
  relay.offeredPorts.get(source)!.onmessage = handlePageEvent;
}

function handleEngineRequest({data: request}: MessageEvent<NativeTransportRequest>) {
  const {openIds, servingSource} = relay;
  if(request.type === 'connect') {
    if(!servingSource) {
      postToEngine({type: 'closed', id: request.id, reason: NO_PAGE_REASON});
      return;
    }

    openIds.add(request.id);
  } else if(!openIds.has(request.id)) {
    // * a connection that closed with its page: the engine learned of it already
    return;
  }

  if(request.type === 'close') {
    openIds.delete(request.id);
  }

  relay.offeredPorts.get(servingSource)!.postMessage(request, request.type === 'send' ? [request.data] : []);
}

function handlePageEvent({data: event}: MessageEvent<NativeTransportEvent>) {
  if(!relay.openIds.has(event.id)) {
    return;
  }

  if(event.type === 'closed') {
    relay.openIds.delete(event.id);
  }

  postToEngine(event);
}

function postToEngine(event: NativeTransportEvent) {
  relay.enginePort!.postMessage(event, event.type === 'data' ? [event.data] : []);
}
