export type SamsungDpadDirection = 'left' | 'right' | 'up' | 'down';
export type SamsungDpadCommand = SamsungDpadDirection | 'activate' | 'back';

const KEY_COMMANDS: Record<string, SamsungDpadCommand> = {
  ArrowLeft: 'left',
  Left: 'left',
  ArrowRight: 'right',
  Right: 'right',
  ArrowUp: 'up',
  Up: 'up',
  ArrowDown: 'down',
  Down: 'down',
  Enter: 'activate',
  Back: 'back',
  BrowserBack: 'back',
  XF86Back: 'back',
};

const KEYCODE_COMMANDS: Record<number, SamsungDpadCommand> = {
  13: 'activate',
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  10009: 'back',
};

export function samsungDpadCommand(key: string, keyCode: number): SamsungDpadCommand | undefined {
  return KEY_COMMANDS[key] ?? KEYCODE_COMMANDS[keyCode];
}

/**
 * Thin Samsung remote adapter. It owns old key-name/keyCode compatibility and
 * repeat suppression; focus/navigation policy stays in useTvNavigation.
 */
export class SamsungDpadInput {
  private lastCommand?: SamsungDpadCommand;
  private lastCommandAt = 0;
  private target?: Document;

  constructor(
    private readonly handler: (command: SamsungDpadCommand, event: KeyboardEvent) => boolean,
    private readonly repeatFloorMs = 95,
  ) {}

  attach(target: Document = document): void {
    if (this.target === target) return;
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown, true);
  }

  detach(): void {
    this.target?.removeEventListener('keydown', this.onKeyDown, true);
    this.target = undefined;
    this.lastCommand = undefined;
    this.lastCommandAt = 0;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const command = samsungDpadCommand(event.key, event.keyCode);
    if (!command) return;

    const now = Date.now();
    if (command === this.lastCommand && now - this.lastCommandAt < this.repeatFloorMs) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!this.handler(command, event)) {
      // Unhandled keys belong to the focused native control (notably text
      // editors). Do not let repeat suppression consume their next keydown.
      this.lastCommand = undefined;
      this.lastCommandAt = 0;
      return;
    }
    this.lastCommand = command;
    this.lastCommandAt = now;
    event.preventDefault();
    event.stopPropagation();
  };
}
