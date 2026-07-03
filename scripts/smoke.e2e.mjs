/**
 * End-to-end smoke test: drives the real app in headless Edge with a stubbed
 * microphone that "hums" a synthesized melody on demand, exercising record →
 * count-in/backing → pitch detection → OSMD render → cursor playback →
 * undo/redo → persistence → time signatures → MusicXML/MIDI export.
 *
 * Usage: start `npm run dev`, then `node scripts/smoke.e2e.mjs [url]`.
 * Screenshots land in scripts/smoke-out/.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const URL = process.argv[2] ?? "http://localhost:5173";
const OUT = new globalThis.URL("./smoke-out/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(OUT, { recursive: true });

// getUserMedia returns a live (silent) stream; window.__startHum(i) makes it
// sing melody i from that moment — mirroring a human who starts humming when
// the app says "recording".
const FAKE_MIC = `
(() => {
  const MELODIES = [
    // C D E F G A B C scale fragment with mixed rhythm at 120 BPM
    [[261.63,0,.42],[293.66,.5,.2],[329.63,.75,.2],[349.23,1,.42],[392,1.5,.42],[440,2,.2],[493.88,2.25,.2],[523.25,2.5,.9]],
    // Bass: C3 – G2 – C3 half notes
    [[130.81,0,.9],[98,1,.9],[130.81,2,1.3]],
  ];
  let ctx = null, master = null;
  navigator.mediaDevices.getUserMedia = async () => {
    ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(dest);
    return dest.stream;
  };
  window.__startHum = (which) => {
    if (!ctx || !master) return "no stream";
    const t0 = ctx.currentTime + 0.05;
    for (const [freq, at, dur] of MELODIES[which]) {
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
    return "ok";
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
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await page.addInitScript(FAKE_MIC);

async function recordPart(buttonText, melodyIndex, humSec) {
  await page.click(`button:has-text("${buttonText}")`);
  await page.waitForSelector("text=Recording…", { timeout: 20000 });
  const started = await page.evaluate((i) => window.__startHum(i), melodyIndex);
  if (started !== "ok") throw new Error(`fake mic not ready: ${started}`);
  await page.waitForTimeout(humSec * 1000);
  await page.click('button:has-text("Stop")');
  await page.waitForSelector('button:has-text("Accept")', { timeout: 20000 });
}

try {
  console.log("1. Load app…");
  await page.goto(URL);
  await page.waitForSelector("text=Record your first part", { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.screenshot({ path: `${OUT}1-empty.png` });

  console.log("2. Record melody (silent 3-2-1 countdown)…");
  await recordPart("＋ Melody", 0, 4.0);
  const preview = await page.textContent(".bg-indigo-50");
  console.log("   preview:", preview?.trim());
  await page.screenshot({ path: `${OUT}2-preview.png` });
  await page.click('button:has-text("Accept")');

  console.log("3. Wait for OSMD render…");
  await page.waitForSelector("main svg", { timeout: 30000 });
  await page.screenshot({ path: `${OUT}3-score.png`, fullPage: true });

  console.log("4. Record bass (count-in + backing track)…");
  await recordPart("＋ Bass", 1, 4.0);
  const preview2 = await page.textContent(".bg-indigo-50");
  console.log("   preview:", preview2?.trim());
  await page.click('button:has-text("Accept")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}4-two-parts.png`, fullPage: true });

  console.log("5. Playback with cursor…");
  await page.click('button:has-text("▶ Play")');
  await page.waitForTimeout(1500);
  const cursorVisible = await page.evaluate(() => {
    const img = document.querySelector("img[id^='cursorImg']");
    return img ? img.style.display !== "none" : false;
  });
  console.log("   cursor visible during playback:", cursorVisible);
  await page.screenshot({ path: `${OUT}5-playing.png` });
  await page.click('button:has-text("■ Stop")');

  console.log("6. Mute + solo toggles…");
  await page.click('button[title="Mute"]');
  const muted = await page.isVisible('button[title="Unmute"]');
  console.log("   mute toggled:", muted);
  await page.click('button[title="Unmute"]');

  console.log("7. Time signature 3/4 re-bars…");
  await page.selectOption('select[aria-label="Time signature"]', "3");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}6-three-four.png`, fullPage: true });
  await page.selectOption('select[aria-label="Time signature"]', "4");
  await page.waitForTimeout(800);

  console.log("8. Undo removes the bass part, redo restores it…");
  await page.click('button[title="Undo (Ctrl+Z)"]'); // undo time-sig 4/4
  await page.click('button[title="Undo (Ctrl+Z)"]'); // undo time-sig 3/4
  await page.click('button[title="Undo (Ctrl+Z)"]'); // undo bass part
  await page.waitForTimeout(600);
  const bassGone = !(await page.isVisible("text=Bass clef")) &&
    (await page.locator("aside input").count()) === 1;
  console.log("   after 3× undo, one part remains:", bassGone);
  await page.click('button[title="Redo (Ctrl+Y)"]');
  await page.waitForTimeout(600);
  const bassBack = (await page.locator("aside input").count()) === 2;
  console.log("   redo restored bass:", bassBack);
  if (!bassGone || !bassBack) throw new Error("undo/redo failed");

  console.log("9. Persistence across reload…");
  await page.reload();
  await page.waitForSelector("main svg", { timeout: 30000 });
  const partsAfterReload = await page.locator("aside input").count();
  console.log("   parts after reload:", partsAfterReload);
  if (partsAfterReload !== 2) throw new Error("persistence failed");
  await page.screenshot({ path: `${OUT}7-after-reload.png`, fullPage: true });

  console.log("10. Export MIDI…");
  const [download2] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.click('button:has-text("MIDI")'),
  ]);
  console.log("   download:", download2.suggestedFilename());
  await download2.saveAs(`${OUT}humscore.mid`);

  console.log("11. Export MusicXML…");
  await page.waitForTimeout(1000);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.click('button:has-text("MusicXML")'),
  ]);
  console.log("   download:", download.suggestedFilename());
  await download.saveAs(`${OUT}humscore.musicxml`);

  const realProblems = problems.filter((p) => !p.includes("favicon"));
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
