// * TeleSignal: the name the Signal engine's connection is reported under (`appSignalManager.onConnectionState`)
export const SIGNAL_CONNECTION_NAME = 'NET-2';

export enum ConnectionStatus {
  Connected,
  Connecting,
  Closed,
  TimedOut
};

export type ConnectionStatusChange = {
  _: 'networkerStatus',
  status: ConnectionStatus,
  dcId: number,
  name: string,
  isFileNetworker: boolean,
  isFileDownload: boolean,
  isFileUpload: boolean,
  retryAt?: number
};
