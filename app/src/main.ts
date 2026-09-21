// The smallest thing that proves the premise: the browser can see the
// keyboard. Everything else builds on this working.

import { midiToName } from "./notes";

const NOTE_ON = 0x90;

function must(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`page has no ${selector} element`);
  }
  return element;
}

must("#app").innerHTML = `
  <h1>Runenote</h1>
  <p id="status">Looking for MIDI keyboards…</p>
  <ul id="devices"></ul>
  <p id="last"></p>
`;
const status = must("#status");
const devices = must("#devices");
const last = must("#last");

function render(access: MIDIAccess): void {
  const inputs = [...access.inputs.values()];
  status.textContent =
    inputs.length === 0
      ? "No MIDI keyboard found. Plug one in; it will appear here."
      : `${inputs.length} MIDI input${inputs.length === 1 ? "" : "s"} connected.`;
  devices.replaceChildren(
    ...inputs.map((input) => {
      const item = document.createElement("li");
      item.textContent = `${input.manufacturer ?? ""} ${input.name ?? "unnamed"}`.trim();
      return item;
    }),
  );
  for (const input of inputs) {
    input.onmidimessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || data.length < 3) {
        return;
      }
      const [command = 0, note = 0, velocity = 0] = data;
      if ((command & 0xf0) === NOTE_ON && velocity > 0) {
        last.textContent = `Last note: ${midiToName(note)} (velocity ${velocity})`;
      }
    };
  }
}

async function connect(): Promise<void> {
  if (!("requestMIDIAccess" in navigator)) {
    status.textContent = "This browser has no Web MIDI. Use Chrome, Edge or Firefox.";
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    render(access);
    access.onstatechange = () => render(access);
  } catch (error) {
    status.textContent = `MIDI access refused: ${String(error)}`;
  }
}

void connect();
