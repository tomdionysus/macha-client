function priorityValue(priority) {
    return priority === 'visible' ? 0 : 1;
}
function abortError() {
    const error = new Error('Artwork request cancelled before it started.');
    error.name = 'AbortError';
    return error;
}
export class ArtworkRequestScheduler {
    maxConcurrent;
    requests = new Map();
    pending = [];
    active = 0;
    sequence = 0;
    constructor(maxConcurrent = 6) {
        this.maxConcurrent = maxConcurrent;
        if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
            throw new Error('Artwork request concurrency must be at least one.');
        }
    }
    request(key, load, priority = 'nearby') {
        let request = this.requests.get(key);
        if (request) {
            request.subscribers += 1;
            if (priorityValue(priority) < priorityValue(request.priority)) {
                request.priority = priority;
                this.sortPending();
            }
            return this.handle(request);
        }
        let resolve;
        let reject;
        const promise = new Promise((promiseResolve, promiseReject) => {
            resolve = promiseResolve;
            reject = promiseReject;
        });
        request = {
            key,
            load,
            priority,
            sequence: this.sequence++,
            subscribers: 1,
            started: false,
            promise,
            resolve,
            reject,
        };
        this.requests.set(key, request);
        this.pending.push(request);
        this.sortPending();
        this.pump();
        return this.handle(request);
    }
    handle(request) {
        let cancelled = false;
        return {
            promise: request.promise,
            cancel: () => {
                if (cancelled)
                    return;
                cancelled = true;
                request.subscribers = Math.max(0, request.subscribers - 1);
                if (request.subscribers !== 0 || request.started)
                    return;
                const index = this.pending.indexOf(request);
                if (index >= 0)
                    this.pending.splice(index, 1);
                this.requests.delete(request.key);
                request.reject(abortError());
            },
            promote: () => {
                if (request.priority === 'visible')
                    return;
                request.priority = 'visible';
                this.sortPending();
                this.pump();
            },
        };
    }
    sortPending() {
        this.pending.sort((a, b) => priorityValue(a.priority) - priorityValue(b.priority) || a.sequence - b.sequence);
    }
    pump() {
        while (this.active < this.maxConcurrent && this.pending.length > 0) {
            const request = this.pending.shift();
            if (request.subscribers === 0)
                continue;
            request.started = true;
            this.active += 1;
            void Promise.resolve().then(request.load).then(request.resolve, request.reject).finally(() => {
                this.active -= 1;
                this.requests.delete(request.key);
                this.pump();
            });
        }
    }
}
