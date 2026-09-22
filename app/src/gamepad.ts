// Xbox-style controller input, reduced to the six things a menu needs.
//
// The Gamepad API has no events for button presses, only a snapshot you poll,
// so this is driven from the animation loop and reports edges: the frame a
// button went down. Menus are short, so holding a direction does not repeat —
// one press, one move, which is also how a d-pad is usually used.

export type Command = "up" | "down" | "left" | "right" | "confirm" | "back" | "start";

// Indices from the Standard Gamepad mapping, which Xbox pads report.
const BUTTONS: ReadonlyArray<[number, Command]> = [
  [0, "confirm"], // A
  [1, "back"], // B
  [9, "start"], // Menu
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
];
const DEADZONE = 0.55;

export class Gamepads {
  private down = new Set<string>();
  private connected = false;

  /** True when at least one pad answered the last poll. */
  get isConnected(): boolean {
    return this.connected;
  }

  /** Call once per frame. Emits each command on the frame it becomes active. */
  poll(emit: (command: Command) => void): void {
    const pads = navigator.getGamepads?.() ?? [];
    const active = new Set<string>();
    let any = false;

    for (const pad of pads) {
      if (!pad?.connected) {
        continue;
      }
      any = true;
      for (const [index, command] of BUTTONS) {
        if (pad.buttons[index]?.pressed) {
          active.add(`${pad.index}:${command}`);
        }
      }
      // The left stick stands in for the d-pad; some pads report only one.
      const [x = 0, y = 0] = pad.axes;
      if (y <= -DEADZONE) {
        active.add(`${pad.index}:up`);
      }
      if (y >= DEADZONE) {
        active.add(`${pad.index}:down`);
      }
      if (x <= -DEADZONE) {
        active.add(`${pad.index}:left`);
      }
      if (x >= DEADZONE) {
        active.add(`${pad.index}:right`);
      }
    }

    this.connected = any;
    for (const key of active) {
      if (!this.down.has(key)) {
        emit(key.slice(key.indexOf(":") + 1) as Command);
      }
    }
    this.down = active;
  }
}

/** The same six commands from the keyboard, so the app is playable without a pad. */
export function keyCommand(event: KeyboardEvent): Command | undefined {
  switch (event.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "Enter":
      return "confirm";
    case "Escape":
    case "Backspace":
      return "back";
    case " ":
      return "start";
    default:
      return undefined;
  }
}
