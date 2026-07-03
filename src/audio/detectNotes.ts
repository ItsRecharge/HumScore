import type { RawNote } from "../score/types";
import { trackPitch } from "./pitchTrack";
import { segmentNotes } from "./segment";

/**
 * The public API of the audio module — the audio→symbolic seam.
 * Everything downstream of this speaks RawNote[] only.
 */
export function detectNotes(pcm: Float32Array, sampleRate: number): RawNote[] {
  return segmentNotes(trackPitch(pcm, sampleRate));
}
