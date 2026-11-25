/*
 * TeleSignal: the clock of Signal's servers as this device reads it. The Signal provider sends how far the device's
 * clock is off (`updateServerTimeOffset`), and the adapter keeps it here (`appSignalManager`), so that the managers
 * compare server dates (message dates, story expiry) as Web A's `getServerTime` does.
 */

import tsNow from '@helpers/tsNow';

export class TimeManager {
  /** Seconds that the server's clock is ahead of the device's */
  public timeOffset = 0;

  public getServerTimeOffset() {
    return this.timeOffset;
  }

  /** Now by the server's clock, in seconds */
  public getServerTime() {
    return tsNow(true) + this.timeOffset;
  }
}
