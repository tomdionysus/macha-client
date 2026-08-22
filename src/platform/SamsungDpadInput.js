const KEY_COMMANDS = {
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
const KEYCODE_COMMANDS = {
    13: 'activate',
    37: 'left',
    38: 'up',
    39: 'right',
    40: 'down',
    10009: 'back',
};
export function samsungDpadCommand(key, keyCode) {
    return KEY_COMMANDS[key] ?? KEYCODE_COMMANDS[keyCode];
}
/**
 * Thin Samsung remote adapter. It owns old key-name/keyCode compatibility and
 * repeat suppression; focus/navigation policy stays in useTvNavigation.
 */
export class SamsungDpadInput {
    handler;
    repeatFloorMs;
    lastCommand;
    lastCommandAt = 0;
    target;
    constructor(handler, repeatFloorMs = 95) {
        this.handler = handler;
        this.repeatFloorMs = repeatFloorMs;
    }
    attach(target = document) {
        if (this.target === target)
            return;
        this.detach();
        this.target = target;
        target.addEventListener('keydown', this.onKeyDown, true);
    }
    detach() {
        this.target?.removeEventListener('keydown', this.onKeyDown, true);
        this.target = undefined;
        this.lastCommand = undefined;
        this.lastCommandAt = 0;
    }
    onKeyDown = (event) => {
        const command = samsungDpadCommand(event.key, event.keyCode);
        if (!command)
            return;
        const now = Date.now();
        if (command === this.lastCommand && now - this.lastCommandAt < this.repeatFloorMs) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        this.lastCommand = command;
        this.lastCommandAt = now;
        if (!this.handler(command, event))
            return;
        event.preventDefault();
        event.stopPropagation();
    };
}
