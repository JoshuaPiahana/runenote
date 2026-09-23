// @vitest-environment happy-dom

// A played note's hold-bar is a progress bar for that note alone. The rule
// that broke once: a bar must not outlive its note. Left behind, bars crowd
// the line with notes already done, and nothing errors when they do.

import { describe, expect, it } from "vitest";
import { readEngraving } from "../src/engrave";
import { Score } from "../src/score";

// Two half notes: C5 then D5, two quarters each.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Right hand</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>2</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>half</type></note>
    <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>half</type></note>
  </measure></part>
</score-partwise>`;

async function setUp() {
  const host = document.createElement("div");
  const score = new Score(host);
  await score.show(XML, "scrolling", "#0f0", "#00f");
  const [first] = readEngraving(XML).notes;
  if (!first) {
    throw new Error("no notes read");
  }
  const track = () => host.querySelector<SVGRectElement>('rect[data-i="0"]');
  const fill = () => host.querySelector<SVGRectElement>("rect.fill");
  return { host, score, first, track, fill };
}

describe("hold-bar feedback", () => {
  it("fills from nothing towards the written length, over a track that length", async () => {
    const { score, first, track, fill } = await setUp();
    const full = Number(track()?.getAttribute("width"));
    score.hit(first);
    expect(Number(fill()?.getAttribute("width"))).toBe(0);
    score.follow(first.start + 1);
    expect(Number(fill()?.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(fill()?.getAttribute("width"))).toBeLessThan(full);
    expect(Number(track()?.getAttribute("width"))).toBe(full);
    expect(track()?.classList.contains("done")).toBe(false);
  });

  it("fades once the note is over", async () => {
    const { score, first, track, fill } = await setUp();
    score.hit(first);
    score.follow(first.start + 5);
    expect(track()?.classList.contains("done")).toBe(true);
    expect(fill()?.classList.contains("done")).toBe(true);
  });

  it("fades when the key comes up early, and no later note is touched", async () => {
    const { host, score, first, track, fill } = await setUp();
    score.hit(first);
    score.follow(first.start + 1);
    score.release(first.midi);
    expect(track()?.classList.contains("done")).toBe(true);
    expect(fill()?.classList.contains("done")).toBe(true);
    expect(host.querySelector('rect[data-i="1"]')?.classList.contains("hit")).toBe(false);
  });

  it("leaves nothing behind for a fresh run", async () => {
    const { host, score, first, track } = await setUp();
    score.hit(first);
    score.follow(first.start + 5);
    score.clearFeedback();
    expect(host.querySelector(".fill, .done, .hit")).toBeNull();
    expect(track()).not.toBeNull();
  });
});
