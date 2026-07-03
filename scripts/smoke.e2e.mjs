/**
 * End-to-end smoke test: drives the real app in headless Edge with a stubbed
 * microphone that plays a synthesized melody, exercising the full flow —
 * record modal → AudioWorklet capture → pitch detection → tempo/key inference
 * → OSMD score render → playback → MusicXML export.
 *
 * Usage: start `npm run dev`, then `node scripts/smoke.e2e.mjs [url]`.
 * Screenshots land in scripts/smoke-out/.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const URL = process.argv[2] ?? "http://localhost:5173";
const OUT = new globalThis.URL("./smoke-out/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(OUT, { recursive: true });

// Replaces getUserMedia with a stream that sings a melody (first call) or a
// bass line (second call), starting the moment recording starts.
const FAKE_MIC = `
(() => {
  const MELODIES = [
    // C D E F G A B C scale fragment with mixed rhythm at 120 BPM
    [[261.63,0,.42],[293.66,.5,.2],[329.63,.75,.2],[349.23,1,.42],[392,1.5,.42],[440,2,.2],[493.88,2.25,.2],[523.25,2.5,.9]],
    // Bass: C3 – G2 – C3 half notes
    [[130.81,0,.9],[98,1,.9],[130.81,2,1.3]],
  ];
  let call = 0;
  navigator.mediaDevices.getUserMedia = async () => {
    const notes = MELODIES[Math.min(call++, MELODIES.length - 1)];
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(dest);
    const t0 = ctx.currentTime + 0.05;
    for (const [freq, at, dur] of notes) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(1, t0 + at + 0.02);
      g.gain.setValueAtTime(1, t0 + at + dur - 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + at + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.05);
    }
    return dest.stream;
  };
})();
`;

const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") {
    problems.push(`console.error: ${m.text()} [${m.location().url}]`);
  }
});
page.on("response", (r) => {
  if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.addInitScript(FAKE_MIC);

async function recordPart(buttonText, waitSec) {
  await page.click(`button:has-text("${buttonText}")`);
  await page.waitForSelector("text=Recording…", { timeout: 15000 });
  await page.waitForTimeout(waitSec * 1000);
  await page.click('button:has-text("Stop")');
  await page.waitForSelector('button:has-text("Accept")', { timeout: 15000 });
}

try {
  console.log("1. Load app…");
  await page.goto(URL);
  await page.waitForSelector("text=Record your first part", { timeout: 20000 });
  await page.screenshot({ path: `${OUT}1-empty.png` });

  console.log("2. Record melody via fake mic…");
  await recordPart("＋ Melody", 4.2);
  const preview = await page.textContent(".bg-indigo-50");
  console.log("   preview:", preview?.trim());
  await page.screenshot({ path: `${OUT}2-preview.png` });
  await page.click('button:has-text("Accept")');

  console.log("3. Wait for OSMD render…");
  await page.waitForSelector("main svg", { timeout: 20000 });
  await page.screenshot({ path: `${OUT}3-score.png`, fullPage: true });

  console.log("4. Record bass part…");
  await recordPart("＋ Bass", 4.0);
  const preview2 = await page.textContent(".bg-indigo-50");
  console.log("   preview:", preview2?.trim());
  await page.click('button:has-text("Accept")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}4-two-parts.png`, fullPage: true });

  const staves = await page.evaluate(() => {
    const svg = document.querySelector("main svg");
    return { svgPresent: !!svg, height: svg?.getBoundingClientRect().height ?? 0 };
  });
  console.log("   score svg:", JSON.stringify(staves));

  console.log("5. Playback…");
  await page.click('button:has-text("▶ Play")');
  await page.waitForTimeout(1200);
  const stopVisible = await page.isVisible('button:has-text("■ Stop")');
  console.log("   playing (stop button shown):", stopVisible);
  await page.click('button:has-text("■ Stop")');

  console.log("6. Export MIDI…");
  const [download2] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.click('button:has-text("MIDI")'),
  ]);
  console.log("   download:", download2.suggestedFilename());
  await download2.saveAs(`${OUT}humscore.mid`);

  console.log("7. Export MusicXML…");
  await page.waitForTimeout(1000); // let the previous download settle
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.click('button:has-text("MusicXML")'),
  ]);
  console.log("   download:", download.suggestedFilename());
  await download.saveAs(`${OUT}humscore.musicxml`);

  const realProblems = problems.filter(
    (p) => !p.includes("favicon") && !p.includes("Download the React DevTools"),
  );
  if (realProblems.length) {
    console.log("\nCONSOLE PROBLEMS:");
    for (const p of realProblems) console.log("  ", p);
    process.exitCode = 1;
  } else {
    console.log("\nSMOKE TEST PASSED — no console errors.");
  }
} catch (err) {
  await page.screenshot({ path: `${OUT}failure.png`, fullPage: true }).catch(() => {});
  console.error("SMOKE TEST FAILED:", err.message);
  if (problems.length) console.error("console problems:", problems.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
