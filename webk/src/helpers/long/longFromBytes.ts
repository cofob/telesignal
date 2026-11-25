import {bigIntFromBytes} from '@helpers/bigInt/bigIntConversion';

/**
 * Reads little-endian bytes (an auth key id, a session
 * id) as an unsigned decimal long.
 */
export default function longFromBytes(bytes: Uint8Array) {
  return bigIntFromBytes(bytes.slice().reverse()).toString();
}
