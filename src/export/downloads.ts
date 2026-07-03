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

function slug(score: Score): string {
  const s = score.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "humscore";
}

export function downloadMusicXML(score: Score): void {
  download(toMusicXML(score), `${slug(score)}.musicxml`, "application/vnd.recordare.musicxml+xml");
}

export function downloadMidi(score: Score): void {
  download(toMidiBytes(score), `${slug(score)}.mid`, "audio/midi");
}

/** Full project file — includes raw recordings, so it round-trips losslessly. */
export function downloadProject(score: Score): void {
  download(JSON.stringify(score, null, 2), `${slug(score)}.humscore.json`, "application/json");
}
