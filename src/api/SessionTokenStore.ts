/**
 * Mutable holder for the current bearer token, shared by every long-lived
 * API client. A refresh (new anonymous session minted after 401 or expiry)
 * only needs to call `set()` here — every client already holding a reference
 * to this store picks up the new value on its next request, with no need to
 * recreate clients or lose the per-session state they own (e.g. an active
 * playback generation's node ownership).
 */
export class SessionTokenStore {
  private value: string | undefined;

  constructor(initial?: string) {
    this.value = initial?.trim() || undefined;
  }

  get current(): string | undefined {
    return this.value;
  }

  set(token: string | undefined): void {
    this.value = token?.trim() || undefined;
  }
}
