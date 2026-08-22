/**
 * Coalesces optimistic Direct Play seeks into serialized playback-session
 * mutations. Local playback never waits for this synchronizer: it exists only
 * to make the server-side session eventually reflect the browser's position.
 */
export class DirectSeekSessionSync {
    update;
    onApplied;
    onFailed;
    debounceMs;
    timer;
    pending;
    inFlight = false;
    sequence = 0;
    disposed = false;
    constructor(update, onApplied, onFailed, debounceMs = 180) {
        this.update = update;
        this.onApplied = onApplied;
        this.onFailed = onFailed;
        this.debounceMs = debounceMs;
    }
    schedule(sessionId, positionMs) {
        if (this.disposed)
            return this.sequence;
        const sequence = ++this.sequence;
        this.pending = {
            sessionId,
            positionMs: Math.max(0, Math.round(positionMs)),
            sequence,
        };
        if (!this.inFlight)
            this.arm(this.debounceMs);
        return sequence;
    }
    /** Drop queued work when another server-side playback mutation supersedes it. */
    clearPending() {
        this.sequence += 1;
        this.pending = undefined;
        if (this.timer !== undefined)
            clearTimeout(this.timer);
        this.timer = undefined;
    }
    dispose() {
        this.disposed = true;
        this.clearPending();
    }
    arm(delayMs) {
        if (this.disposed || this.inFlight || !this.pending)
            return;
        if (this.timer !== undefined)
            clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush();
        }, Math.max(0, delayMs));
    }
    async flush() {
        if (this.disposed || this.inFlight || !this.pending)
            return;
        const request = this.pending;
        this.pending = undefined;
        this.inFlight = true;
        try {
            const session = await this.update(request.sessionId, request.positionMs);
            if (!this.disposed && request.sequence === this.sequence && !this.pending) {
                this.onApplied(session, request);
            }
        }
        catch (error) {
            if (!this.disposed)
                this.onFailed(error, request);
        }
        finally {
            this.inFlight = false;
            // A seek that arrived while the previous PATCH was running has already
            // spent time waiting, so send the latest one immediately rather than
            // applying another debounce interval.
            if (!this.disposed && this.pending)
                this.arm(0);
        }
    }
}
