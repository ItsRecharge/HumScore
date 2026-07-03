import { PitchDetector } from "pitchy";

export interface PitchFrame {
  timeSec: number;
  /** Detected fundamental in Hz, or null when unpitched/implausible. */
  freqHz: number | null;
  /** Pitch clarity 0..1 from the McLeod pitch method. */
  clarity: number;
  rms: number;
}

const MIN_HUM_HZ = 55;
const MAX_HUM_HZ = 1200;

export interface PitchTrackOptions {
  windowSize?: number;
  hopSize?: number;
}

/** Frame-by-frame pitch track over a whole recording (offline analysis). */
export function trackPitch(
  pcm: Float32Array,
  sampleRate: number,
  opts: PitchTrackOptions = {},
): PitchFrame[] {
  const windowSize = opts.windowSize ?? 2048;
  const hopSize = opts.hopSize ?? 512;
  const detector = PitchDetector.forFloat32Array(windowSize);
  const frames: PitchFrame[] = [];

  for (let start = 0; start + windowSize <= pcm.length; start += hopSize) {
    const frame = pcm.subarray(start, start + windowSize);
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const [freq, clarity] = detector.findPitch(frame, sampleRate);
    const plausible = Number.isFinite(freq) && freq >= MIN_HUM_HZ && freq <= MAX_HUM_HZ;
    frames.push({
      timeSec: (start + windowSize / 2) / sampleRate,
      freqHz: plausible ? freq : null,
      clarity: Number.isFinite(clarity) ? clarity : 0,
      rms,
    });
  }
  return frames;
}
