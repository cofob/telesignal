/**
 * The AudioWorklet half of the native voice recorder (nativeVoiceRecorder.ts): it hands the microphone's samples to
 * the page in buffers of `bufferSize`. TeleSignal serves it as a file of the app, since the page's policy loads no
 * scripts from `blob:` URLs.
 */

// AudioWorkletGlobalScope, which TypeScript's DOM library does not describe.
declare class AudioWorkletProcessor {
  public readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

// * the name `nativeVoiceRecorder.ts` creates its node with
const VOICE_CAPTURE_PROCESSOR = 'voice-capture-processor';
const DEFAULT_BUFFER_SIZE = 2048;

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  private bufferSize: number;
  private buffer: Float32Array;
  private bufferIndex = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.bufferSize = options?.processorOptions?.bufferSize || DEFAULT_BUFFER_SIZE;
    this.buffer = new Float32Array(this.bufferSize);
  }

  public process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0];
    if(!channel?.length) return true;

    let i = 0;
    while(i < channel.length) {
      const toCopy = Math.min(this.bufferSize - this.bufferIndex, channel.length - i);
      this.buffer.set(channel.subarray(i, i + toCopy), this.bufferIndex);
      this.bufferIndex += toCopy;
      i += toCopy;
      if(this.bufferIndex === this.bufferSize) {
        this.port.postMessage(this.buffer.slice(0));
        this.bufferIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor(VOICE_CAPTURE_PROCESSOR, VoiceCaptureProcessor);
