// Notation, two ways. The scrolling view is one line of music moving past a
// fixed play line, drawn by engrave.ts with space in proportion to time, so
// the line moves at a constant speed. The traditional view is the printed
// page, and there OpenSheetMusicDisplay's engraving is the right tool: it
// spaces for reading, which is what a page is for.

import { ColoringModes, type IOSMDOptions, OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { type Hand, type Layout, layout, readEngraving } from "./engrave";

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
/** How long a wrong note stays on the line. Matches the fade in style.css. */
const WRONG_FADE_MS = 1400;

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
  /** Bars of notes being held, growing with the play line. */
  private fills: { rect: SVGRectElement; start: number; full: number; midi: number }[] = [];
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
      this.fills = [];
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
   * the start it keeps going, off the left of the drawing, so in the count-in
   * the music slides in towards the line at the speed it will be played;
   * after the end it runs on to the edge, so the last note still crosses.
   */
  positionAt(quarters: number): number {
    const drawn = this.drawn;
    if (!drawn) {
      return 0;
    }
    const x = drawn.origin + quarters * drawn.pxPerQuarter;
    return Math.min(x, drawn.width);
  }

  /**
   * Lights a written note the player has played, and starts its hold-bar.
   * The bar is not drawn until then: it grows out of the notehead with the
   * play line for as long as the key is held, up to the note's written
   * length, so it shows how long the player actually held it against how
   * long they were asked to. Only the moving view shows feedback: the page
   * is for reading, and marks on it would stay.
   */
  hit(note: { start: number; midi: number; hand: string }): void {
    const index = this.drawn?.heads.findIndex(
      (head) =>
        Math.abs(head.note.start - note.start) < 1e-6 &&
        head.note.midi === note.midi &&
        head.note.hand === note.hand,
    );
    if (index === undefined || index === -1) {
      return;
    }
    for (const element of this.line.querySelectorAll(`[data-i="${index}"]`)) {
      element.classList.add("hit");
      if (element instanceof SVGRectElement) {
        const full = Number(element.dataset.full ?? element.getAttribute("width"));
        element.dataset.full = String(full);
        element.setAttribute("width", "0");
        this.fills.push({ rect: element, start: note.start, full, midi: note.midi });
      }
    }
  }

  /** Grows every held note's bar to where the play line has reached. */
  follow(quarters: number): void {
    const perQuarter = this.drawn?.pxPerQuarter ?? 0;
    this.fills = this.fills.filter((fill) => {
      const width = Math.min(Math.max((quarters - fill.start) * perQuarter, 0), fill.full);
      fill.rect.setAttribute("width", width.toFixed(1));
      return width < fill.full;
    });
  }

  /** A key came up: its bar stops where it is, short if let go early. */
  release(midi: number): void {
    this.fills = this.fills.filter((fill) => fill.midi !== midi);
  }

  /** Rings a key pressed that was not wanted, where it was pressed. It fades
      on its own, so a flurry of wrong notes does not pile up on the line. */
  wrong(quarters: number, midi: number, hand: Hand | undefined, colour: string): void {
    const svg = this.line.querySelector("svg");
    if (!this.drawn || !svg) {
      return;
    }
    svg.insertAdjacentHTML(
      "beforeend",
      `<g class="wrong">${this.drawn.wrongNote(quarters, midi, hand, colour)}</g>`,
    );
    const ring = svg.lastElementChild;
    setTimeout(() => ring?.remove(), WRONG_FADE_MS);
  }

  /** Takes every mark off, for a fresh run over the same drawing. */
  clearFeedback(): void {
    this.fills = [];
    for (const rect of this.line.querySelectorAll<SVGRectElement>("rect[data-full]")) {
      rect.setAttribute("width", rect.dataset.full ?? "0");
    }
    for (const element of this.line.querySelectorAll(".hit")) {
      element.classList.remove("hit");
    }
    for (const element of this.line.querySelectorAll(".wrong")) {
      element.remove();
    }
  }

  get isScrolling(): boolean {
    return this.view === "scrolling";
  }
}
