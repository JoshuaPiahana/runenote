// Wiring: pack on the left, keyboard on the right, notation in the middle.
// Pick a song and a level and the tier's MusicXML is drawn. Nothing listens
// to the notes yet beyond showing the last one; that is the next slice.

import "./style.css";
import { type LoadedPack, loadPack, loadTier, type Song, type Tier } from "./bundle";
import { connectMidi } from "./midi";
import { midiToName } from "./notes";
import { Score } from "./score";

// The only pack the app knows about for now. Family packs are imported at
// runtime later; the core pack is what ships.
const PACK_BASE = "/packs/core";

function must(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`page has no ${selector} element`);
  }
  return element;
}

must("#app").innerHTML = `
  <header>
    <h1>Runenote</h1>
    <p class="muted"><span id="keyboard">Looking for MIDI keyboards…</span> <span id="last"></span></p>
  </header>
  <section class="controls">
    <label>Song <select id="song"></select></label>
    <fieldset id="levels"><legend>Level</legend></fieldset>
  </section>
  <p id="about" class="muted"></p>
  <p id="error" role="alert" hidden></p>
  <div id="score"></div>
`;

const keyboardLine = must("#keyboard");
const lastNote = must("#last");
const songSelect = must("#song") as HTMLSelectElement;
const levels = must("#levels");
const about = must("#about");
const errorLine = must("#error");
const score = new Score(must("#score"));

function showError(error: unknown): void {
  errorLine.textContent = error instanceof Error ? error.message : String(error);
  errorLine.hidden = false;
}

function describeTier(tier: Tier): string {
  const hands = tier.hands === "both" ? "both hands" : `${tier.hands} hand`;
  return `${tier.level} · ${hands} · ${midiToName(tier.range.low)}–${midiToName(tier.range.high)}`;
}

function describeSong(song: Song): string {
  return [song.composer, song.key, song.time_signature, `♩ = ${song.tempo_bpm}`]
    .filter(Boolean)
    .join(" · ");
}

async function showTier(song: Song, tier: Tier): Promise<void> {
  errorLine.hidden = true;
  try {
    await score.show(await loadTier(PACK_BASE, song, tier));
  } catch (error) {
    showError(error);
  }
}

function showSong(song: Song): void {
  about.textContent = describeSong(song);
  levels.replaceChildren(
    Object.assign(document.createElement("legend"), { textContent: "Level" }),
    ...song.tiers.map((tier, index) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "level";
      input.value = String(tier.level);
      input.checked = index === 0;
      input.onchange = () => void showTier(song, tier);
      label.append(input, ` ${describeTier(tier)}`);
      return label;
    }),
  );
  // A song always opens at its easiest level: that is the one a player is
  // most likely to be able to read, and moving up is one click.
  const first = song.tiers[0];
  if (first) {
    void showTier(song, first);
  }
}

function showPack({ pack, songs }: LoadedPack): void {
  songSelect.replaceChildren(
    ...songs.map((song) => new Option(song.title, song.id)),
    ...(songs.length === 0 ? [new Option(`${pack.name} has no songs`, "")] : []),
  );
  songSelect.onchange = () => {
    const song = songs.find((s) => s.id === songSelect.value);
    if (song) {
      showSong(song);
    }
  };
  const first = songs[0];
  if (first) {
    showSong(first);
  }
}

void loadPack(PACK_BASE).then(showPack, showError);

void connectMidi({
  onInputs(names) {
    keyboardLine.textContent =
      names.length === 0
        ? "No MIDI keyboard found. Plug one in; it will appear here."
        : `Keyboard: ${names.join(", ")}`;
  },
  onNoteOn(note, velocity) {
    lastNote.textContent = `Last note: ${midiToName(note)} (velocity ${velocity})`;
  },
  onUnavailable(reason) {
    keyboardLine.textContent = reason;
  },
});
