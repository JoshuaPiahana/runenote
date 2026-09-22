// The keyboard, as the browser sees it. Reports which inputs are connected
// and every note-on; the play-along modes build on this.

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

export interface MidiListener {
  /** Called whenever the set of connected inputs changes, with their names. */
  onInputs(names: string[]): void;
  onNoteOn(note: number, velocity: number): void;
  onNoteOff(note: number): void;
  /** Web MIDI is missing or was refused; the app still works, silently. */
  onUnavailable(reason: string): void;
}

function attach(access: MIDIAccess, listener: MidiListener): void {
  const inputs = [...access.inputs.values()];
  listener.onInputs(inputs.map((i) => `${i.manufacturer ?? ""} ${i.name ?? "unnamed"}`.trim()));
  for (const input of inputs) {
    input.onmidimessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || data.length < 3) {
        return;
      }
      const [command = 0, note = 0, velocity = 0] = data;
      const kind = command & 0xf0;
      // Many keyboards send note-off as note-on with velocity 0.
      if (kind === NOTE_ON && velocity > 0) {
        listener.onNoteOn(note, velocity);
      } else if (kind === NOTE_OFF || (kind === NOTE_ON && velocity === 0)) {
        listener.onNoteOff(note);
      }
    };
  }
}

export async function connectMidi(listener: MidiListener): Promise<void> {
  if (!("requestMIDIAccess" in navigator)) {
    listener.onUnavailable("This browser has no Web MIDI. Use Chrome, Edge or Firefox.");
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    attach(access, listener);
    access.onstatechange = () => attach(access, listener);
  } catch (error) {
    listener.onUnavailable(`MIDI access refused: ${String(error)}`);
  }
}
