/*
 * TeleSignal: `src/lib/signal/net/NativeTransport.ts`, the engine's side of the desktop app's native transport, which
 * the worker hands its port (`lib/signal/nativeTransport`).
 */

/** Messages from the engine to the page, which calls the desktop app's commands (`tauri/src/transport.rs`) */
export type NativeTransportRequest =
  | {type: 'connect', id: number, host: string, trafficClass: 'authenticated' | 'unauthenticated'}
  | {type: 'send', id: number, data: ArrayBuffer}
  | {type: 'ack', id: number, byteLength: number}
  | {type: 'close', id: number};

/** Messages from the page to the engine */
export type NativeTransportEvent =
  | {type: 'open', id: number}
  | {type: 'data', id: number, data: ArrayBuffer}
  | {type: 'sent', id: number, byteLength: number}
  | {type: 'closed', id: number, reason: string};

/** Makes the engine open its connections natively, through this port, unless the proxy settings name a tunnel */
export function setNativeTransportPort(port: MessagePort): void;
