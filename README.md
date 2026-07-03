# HumScore 🎼

Hum the parts of a song one at a time — melody, bass, a countermelody — and
get real, editable, playable sheet music. Fully client-side: no server, no
API keys, no ML model downloads.

## How it works

1. **Hum a part** (one voice at a time — each hum is monophonic).
2. HumScore **transcribes** the hum into notes (pitch detection via the
   McLeod pitch method), **infers the tempo and key**, and **quantizes** the
   rhythm onto a sixteenth grid.
3. Your **first part establishes the grid**; when you record later parts you
   get a **click count-in and hear the existing parts as a backing track**
   (🎧 headphones recommended), so overdubs stay in sync.
4. Rule-based **harmonization** (Viterbi over diatonic triads) adds chord
   symbols — no LLM involved.
5. The score renders as engraved notation with a **playback cursor**, plays
   back in the browser, and exports as **MusicXML** and **MIDI**.

Also on board: per-part **mute/solo**, note editing (pitch nudge, duration,
delete, click-to-audition), a piano-roll preview of every take before you
accept it, **undo/redo** (Ctrl+Z / Ctrl+Y), Space to play/stop, **tap tempo**
and ÷2/×2 tempo-octave fixes, **4/4, 3/4 and 2/4** time signatures, and
autosave to localStorage so a refresh never loses your score.

If tempo detection is uncertain (free-form/rubato humming is genuinely hard),
an amber dot appears next to the BPM — set it manually and hit *Re-quantize*;
raw recordings are retained so re-quantizing is lossless.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run test       # vitest (theory, serializer, and audio-pipeline tests)
npm run build      # typecheck + production build
```

### End-to-end smoke test

Drives the real app in headless Edge with a stubbed microphone that "hums" a
synthesized melody, exercising record → transcribe → render → play → export:

```bash
npm run dev &
node scripts/smoke.e2e.mjs
```

Screenshots and exported files land in `scripts/smoke-out/`.

## Architecture

The hard seam: **audio → notes** (signal processing) and **notes → score**
(symbolic music theory) are separate modules; only `RawNote[]` (seconds
domain) crosses the boundary via `audio/detectNotes.ts`. Everything symbolic
is tick-based (16 ticks per 4/4 measure) and pure — covered by vitest.

```
src/
  audio/      mic capture (AudioWorklet), pitch tracking (pitchy), note segmentation
  theory/     tempo inference, quantization, key inference (Krumhansl–Kessler),
              harmonization (Viterbi over diatonic triads)
  score/      score model, MusicXML serializer
  playback/   Tone.js playback (a synth per part + chord poly synth)
  export/     MusicXML / MIDI downloads
  state/      React reducer store
  components/ Toolbar, PartsPanel, ScoreView (OpenSheetMusicDisplay), RecordModal, PartEditor
```

Built with Vite + React 18 + TypeScript + Tailwind, pitchy,
OpenSheetMusicDisplay, Tone.js, and @tonejs/midi.
