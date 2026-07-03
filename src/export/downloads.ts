import { toMusicXML } from "../score/musicxml";
import type { Score } from "../score/types";
import { toMidiBytes } from "./midiExport";

function download(data: BlobPart, filename: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking synchronously can abort a download that hasn't started streaming.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadMusicXML(score: Score): void {
  download(toMusicXML(score), "humscore.musicxml", "application/vnd.recordare.musicxml+xml");
}

export function downloadMidi(score: Score): void {
  download(toMidiBytes(score), "humscore.mid", "audio/midi");
}
