export class TizenPlatform {
    bridge;
    name = 'tizen';
    constructor(bridge) {
        this.bridge = bridge;
    }
    capabilities() {
        return this.bridge.capabilities();
    }
    createPlayer() {
        return this.bridge.createPlayer();
    }
    exitApplication() {
        this.bridge.exitApplication?.();
    }
}
