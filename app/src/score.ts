// Notation on screen. A thin wrapper over OpenSheetMusicDisplay so the rest
// of the app never touches its API directly: when the play-along cursor
// arrives it will live here too.

import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";

export class Score {
  private readonly osmd: OpenSheetMusicDisplay;
  // OSMD holds one sheet and `load` replaces it, so loads must not overlap:
  // a slow one finishing after a fast one would leave the drawing and the
  // sheet disagreeing. Requests queue, and a request overtaken before it
  // starts is dropped rather than drawn and immediately replaced.
  private queue: Promise<void> = Promise.resolve();
  private latest = 0;

  constructor(container: HTMLElement) {
    this.osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      // The page already shows the title and composer; the staves are what
      // the player reads. Part names are off because a piano score does not
      // label its hands.
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawCredits: false,
      drawPartNames: false,
      drawMeasureNumbers: true,
    });
  }

  show(musicXml: string): Promise<void> {
    const request = ++this.latest;
    const run = this.queue.then(async () => {
      if (request !== this.latest) {
        return;
      }
      await this.osmd.load(musicXml);
      this.osmd.render();
    });
    // A failed load must not block the next one; the caller still sees it.
    this.queue = run.catch(() => undefined);
    return run;
  }
}
