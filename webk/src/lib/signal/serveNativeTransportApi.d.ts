/*
 * TeleSignal: `src/util/tauri/serveNativeTransport.ts`, the page's side of the desktop app's native transport, which
 * calls the app's commands for the engine of the worker. Only the app's pages load it.
 */

/** Serves the engine's requests on the port; returns a function that closes the port and the connections */
export default function serveNativeTransport(port: MessagePort): () => void;
