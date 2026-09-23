// Notation that moves. One line of music, scrolling horizontally past a fixed
// play line, drawn dark with the notes in the hand's colour.
//
// The engraving is OpenSheetMusicDisplay's; what this adds is time. OSMD lays
// a score out in space and says nothing about when a note happens, so after
// rendering we read the laid-out sheet once and record where each moment sits
// in pixels. Everything after that is interpolation between those points,
// which is why scrolling is smooth and stays in step with notes of any length.

import { ColoringModes, type IOSMDOptions, OpenSheetMusicDisplay } from "opensheetmusicdisplay";

export type ScoreView = "scrolling" | "traditional";

/** A moment in the music and the pixel it was drawn at. */
interface Point {
  /** Quarter notes from the start. */
  t: number;
  x: number;
}

/** OSMD timestamps count whole notes; the rest of the app counts quarters. */
const QUARTERS_PER_WHOLE = 4;
/** OSMD lays out in its own units and draws them at ten pixels each, scaled
    by zoom. The constant is not on the public API, so it is written here and
    confirmed on screen: if it were wrong the play line would drift off the
    notes within a bar or two, which is impossible to miss. */
const UNIT_IN_PIXELS = 10;

const SHARED: IOSMDOptions = {
  // The page already names the piece; the staves are what the player reads.
  drawTitle: false,
  drawSubtitle: false,
  drawComposer: false,
  drawCredits: false,
  drawPartNames: false,
  drawMeasureNumbers: true,
  // Re-rendering on resize would invalidate the time-to-pixel map without
  // telling us, so resizing is handled by reloading instead.
  autoResize: false,
  colorStemsLikeNoteheads: true,
  coloringMode: ColoringModes.XML,
};

const VIEWS: Record<ScoreView, IOSMDOptions> = {
  scrolling: {
    ...SHARED,
    // Every bar on one line: the thing that scrolls. OSMD reads this when it
    // loads, not when it renders, so changing view means loading again.
    renderSingleHorizontalStaffline: true,
    defaultColorMusic: "#7f8aa6",
    pageBackgroundColor: "#0f1320",
  },
  traditional: {
    ...SHARED,
    renderSingleHorizontalStaffline: false,
    defaultColorMusic: "#1a1a1a",
    pageBackgroundColor: "#f4f1ea",
  },
};

/**
 * Writes a colour onto every note, chosen by the part it belongs to, so the
 * two hands are told apart at a glance. Done here rather than in the pipeline
 * because it is a question about this screen, not about the arrangement, and
 * a bundle is a build product nobody hand-edits.
 *
 * Unparseable input comes back untouched, so the error the player sees is
 * OSMD's report about the file rather than something invented here.
 */
export function colourNotesByHand(xml: string, right: string, left: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror")[0]) {
    return xml;
  }
  const hands = new Map<string, string>();
  for (const part of doc.getElementsByTagName("score-part")) {
    const id = part.getAttribute("id");
    const name = part.getElementsByTagName("part-name")[0]?.textContent ?? "";
    if (id) {
      hands.set(id, /left/i.test(name) ? left : right);
    }
  }
  for (const part of doc.getElementsByTagName("part")) {
    const colour = hands.get(part.getAttribute("id") ?? "") ?? right;
    for (const note of part.getElementsByTagName("note")) {
      // Rests keep the staff colour: colour here means "you play this".
      if (!note.getElementsByTagName("rest")[0]) {
        note.setAttribute("color", colour);
      }
    }
  }
  // Serialising the root element rather than the document drops the DOCTYPE,
  // whose external DTD reference stops OSMD recognising the result as a
  // partwise score. The XML declaration goes back on by hand because OSMD
  // decides whether a string is music or a URL to fetch by looking for it.
  // Handing OSMD the Document object instead is not the way round this: that
  // path hangs the renderer outright.
  return `<?xml version="1.0" encoding="UTF-8"?>
${new XMLSerializer().serializeToString(doc.documentElement)}`;
}

export class Score {
  private osmd: OpenSheetMusicDisplay;
  private view: ScoreView = "scrolling";
  private points: Point[] = [];
  private end = 0;
  // OSMD holds one sheet and `load` replaces it, so loads must not overlap: a
  // slow one finishing after a fast one would leave the drawing and the sheet
  // disagreeing. Requests queue, and one overtaken before it starts is dropped.
  private queue: Promise<void> = Promise.resolve();
  private latest = 0;

  constructor(host: HTMLElement) {
    this.osmd = new OpenSheetMusicDisplay(host, VIEWS.scrolling);
  }

  show(musicXml: string, view: ScoreView, right: string, left: string): Promise<void> {
    const request = ++this.latest;
    const run = this.queue.then(async () => {
      if (request !== this.latest) {
        return;
      }
      this.view = view;
      this.osmd.setOptions(VIEWS[view]);
      await this.osmd.load(colourNotesByHand(musicXml, right, left));
      this.osmd.render();
      this.points = view === "scrolling" ? this.mapTimeToPixels() : [];
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Where each moment of the music was drawn. Read from the laid-out score
   * rather than by stepping the cursor, which moves a DOM element on every
   * step and takes long enough over a whole piece to freeze the tab.
   *
   * Both staves carry an entry at the same moment, so the leftmost wins and
   * the two hands stay on one timeline.
   */
  private mapTimeToPixels(): Point[] {
    const byTime = new Map<number, number>();
    let rightEdge = 0;
    try {
      for (const staves of this.osmd.GraphicSheet.MeasureList ?? []) {
        for (const measure of staves ?? []) {
          const box = measure?.PositionAndShape;
          if (box) {
            rightEdge = Math.max(rightEdge, box.AbsolutePosition.x + box.Size.width);
          }
          for (const entry of measure?.staffEntries ?? []) {
            const t = entry.getAbsoluteTimestamp().RealValue * QUARTERS_PER_WHOLE;
            const x = entry.PositionAndShape.AbsolutePosition.x;
            byTime.set(t, Math.min(byTime.get(t) ?? Number.POSITIVE_INFINITY, x));
          }
        }
      }
    } catch {
      // A layout we cannot read is not worth failing the screen over; the
      // sheet still draws, it just does not scroll.
      return [];
    }
    if (byTime.size < 2 || rightEdge <= 0) {
      return [];
    }
    const scale = UNIT_IN_PIXELS * (this.osmd.zoom || 1);
    this.end = rightEdge * scale;
    return [...byTime.entries()].map(([t, x]) => ({ t, x: x * scale })).sort((a, b) => a.t - b.t);
  }

  /** Pixel x of a moment, in the rendered sheet's own coordinates. */
  positionAt(quarters: number): number {
    const points = this.points;
    if (points.length < 2) {
      return 0;
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) {
      return 0;
    }
    if (quarters <= first.t) {
      return first.x;
    }
    // Past the last onset, keep moving at the last known speed so the final
    // note still travels to the play line instead of stopping short of it.
    if (quarters >= last.t) {
      const tail = Math.max(this.end - last.x, 0);
      const span = Math.max(last.t - first.t, 1);
      return last.x + Math.min((quarters - last.t) / span, 1) * tail;
    }
    let low = 0;
    let high = points.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if ((points[mid]?.t ?? 0) <= quarters) {
        low = mid;
      } else {
        high = mid;
      }
    }
    const a = points[low];
    const b = points[high];
    if (!a || !b || b.t === a.t) {
      return a?.x ?? 0;
    }
    return a.x + ((quarters - a.t) / (b.t - a.t)) * (b.x - a.x);
  }

  get isScrolling(): boolean {
    return this.view === "scrolling";
  }
}
