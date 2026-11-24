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
 */

import type {NativeTransportEvent, NativeTransportRequest} from '@signal-app/native-transport';
import {setNativeTransportPort} from '@signal-app/native-transport';

const PAGE_CLOSED_REASON = 'The page that served the connection closed';
const NO_PAGE_REASON = 'No page serves the native transport';

const relay: {
  // * the ports that the pages offered, oldest first, by the page
  offeredPorts: Map<MessageEventSource, MessagePort>,
  servingSource?: MessageEventSource,
  enginePort?: MessagePort,
  // * the connections that the engine opened and that have not closed, by the engine's id
  openIds: Set<number>
} = {offeredPorts: new Map(), openIds: new Set()};

/** Takes a page's end of the native transport; the first one also tells the engine that the app connects natively */
export function offerNativeTransportPort(source: MessageEventSource, port: MessagePort) {
  releaseNativeTransportSource(source);
  relay.offeredPorts.set(source, port);

  if(!relay.enginePort) {
    const channel = new MessageChannel();
    relay.enginePort = channel.port1;
    relay.enginePort.onmessage = handleEngineRequest;
    // * a page's offer comes before its request to start the engine, so the engine connects natively from the first
    setNativeTransportPort(channel.port2);
  }

  if(!relay.servingSource) {
    serveFrom(source);
  }
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
