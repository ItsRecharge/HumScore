/**
 * Microphone capture via AudioWorklet. The worklet module is loaded from an
 * inline Blob URL so the bundler never sees it (avoids Vite worklet issues).
 * Produces raw Float32 PCM at the AudioContext's native sample rate.
 */

const WORKLET_SRC = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCaptureProcessor);
`;

const LEVEL_CHUNK_TARGET = 2048; // ~43 ms at 48 kHz between level callbacks

export interface Recording {
  pcm: Float32Array;
  sampleRate: number;
}

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private levelBuffer: Float32Array[] = [];
  private levelSamples = 0;

  async start(onLevel?: (rms: number) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.ctx = new AudioContext();
    await this.ctx.resume();

    const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      this.chunks.push(e.data);
      if (!onLevel) return;
      this.levelBuffer.push(e.data);
      this.levelSamples += e.data.length;
      if (this.levelSamples >= LEVEL_CHUNK_TARGET) {
        let sum = 0;
        let count = 0;
        for (const c of this.levelBuffer) {
          for (let i = 0; i < c.length; i++) sum += c[i] * c[i];
          count += c.length;
        }
        onLevel(Math.sqrt(sum / count));
        this.levelBuffer = [];
        this.levelSamples = 0;
      }
    };

    // Keep the graph pulling without echoing the mic to the speakers.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    source.connect(this.workletNode);
    this.workletNode.connect(mute);
    mute.connect(this.ctx.destination);
  }

  async stop(): Promise<Recording> {
    const sampleRate = this.ctx?.sampleRate ?? 48000;
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    const pcm = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    this.dispose();
    return { pcm, sampleRate };
  }

  dispose(): void {
    this.workletNode?.port.close();
    this.workletNode?.disconnect();
    this.workletNode = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.chunks = [];
    this.levelBuffer = [];
    this.levelSamples = 0;
  }
}
