// Notation, two ways. The scrolling view is one line of music moving past a
// fixed play line, drawn by engrave.ts with space in proportion to time, so
// the line moves at a constant speed. The traditional view is the printed
// page, and there OpenSheetMusicDisplay's engraving is the right tool: it
// spaces for reading, which is what a page is for.

import { ColoringModes, type IOSMDOptions, OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { type Layout, layout, readEngraving } from "./engrave";

export type ScoreView = "scrolling" | "traditional";

const PAGE: IOSMDOptions = {
  // The page already names the piece; the staves are what the player reads.
  drawTitle: false,
  drawSubtitle: false,
  drawComposer: false,
  drawCredits: false,
  drawPartNames: false,
  drawMeasureNumbers: true,
  autoResize: false,
  colorStemsLikeNoteheads: true,
  coloringMode: ColoringModes.XML,
  renderSingleHorizontalStaffline: false,
  defaultColorMusic: "#1a1a1a",
  pageBackgroundColor: "#f4f1ea",
};

/** Clefs and barlines, and the quieter stave lines under the notes. */
const MUSIC_INK = "#7f8aa6";
const LINE_INK = "#353c52";

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
  private page: HTMLElement;
  private line: HTMLElement;
  private view: ScoreView = "scrolling";
  private drawn: Layout | undefined;
  // OSMD holds one sheet and `load` replaces it, so loads must not overlap: a
  // slow one finishing after a fast one would leave the drawing and the sheet
  // disagreeing. Requests queue, and one overtaken before it starts is dropped.
  private queue: Promise<void> = Promise.resolve();
  private latest = 0;

  constructor(host: HTMLElement) {
    // Each view keeps its own element: OSMD owns what it draws into and does
    // not expect anyone else to clear it.
    this.line = host.appendChild(document.createElement("div"));
    this.page = host.appendChild(document.createElement("div"));
    this.osmd = new OpenSheetMusicDisplay(this.page, PAGE);
  }

  show(musicXml: string, view: ScoreView, right: string, left: string): Promise<void> {
    const request = ++this.latest;
    const run = this.queue.then(async () => {
      if (request !== this.latest) {
        return;
      }
      this.view = view;
      this.line.hidden = view !== "scrolling";
      this.page.hidden = view !== "traditional";
      if (view === "scrolling") {
        this.drawn = layout(readEngraving(musicXml), {
          right,
          left,
          music: MUSIC_INK,
          lines: LINE_INK,
        });
        this.line.innerHTML = this.drawn.svg;
        return;
      }
      this.drawn = undefined;
      this.line.innerHTML = "";
      await this.osmd.load(colourNotesByHand(musicXml, right, left));
      this.osmd.render();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Pixel x of a moment, in the drawn line's own coordinates. Space is time,
   * so this is one multiplication: no map to read, nothing to smooth. Before
   * the start the line waits on its first beat; after the end it runs on to
   * the edge, so the last note still crosses the play line.
   */
  positionAt(quarters: number): number {
    const drawn = this.drawn;
    if (!drawn) {
      return 0;
    }
    const x = drawn.origin + Math.max(quarters, 0) * drawn.pxPerQuarter;
    return Math.min(x, drawn.width);
  }

  get isScrolling(): boolean {
    return this.view === "scrolling";
  }
}
