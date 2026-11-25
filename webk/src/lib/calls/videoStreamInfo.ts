export interface VideoStreamEvent {
  offsetValue: number;
  endpointId: string;
  rotation: number;
  extra: number;
}

export interface VideoStreamInfo {
  contentOffset: number;
  container: string;
  activeMask: number;
  events: VideoStreamEvent[];
  bytes: Uint8Array;
}

export function parseVideoStreamInfo(buf: Uint8Array) {
  const originalBuf = buf;
  if(buf.length % 4 !== 0) {
    buf = buf.subarray(0, buf.length - buf.length % 4);
  }
  const r = createReader(buf);

  if(r.fetchInt() !== -1590787827) { // 0xa12e810d
    throw new Error('Invalid video stream info');
  }
  const container = r.fetchString();
  const activeMask = r.fetchInt();
  const eventCount = r.fetchInt();

  const events = new Array(eventCount);
  for(let i = 0; i < eventCount; i++) {
    events[i] = {
      offsetValue: r.fetchInt(),
      endpointId: r.fetchString(),
      rotation: r.fetchInt(),
      extra: r.fetchInt()
    };
  }

  return {
    contentOffset: r.getOffset(),
    container,
    activeMask,
    events,
    bytes: originalBuf
  };
}

// * the TL values the stream info has: 32-bit integers and strings, a string padded to four bytes
function createReader(buf: Uint8Array) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 0;
  return {
    fetchInt() {
      const value = view.getInt32(offset, true);
      offset += 4;
      return value;
    },
    fetchString() {
      let length = buf[offset++];
      if(length === 254) {
        length = buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
        offset += 3;
      }

      const value = new TextDecoder().decode(buf.subarray(offset, offset + length));
      offset += length;
      offset += (4 - offset % 4) % 4;
      return value;
    },
    getOffset() {
      return offset;
    }
  };
}
