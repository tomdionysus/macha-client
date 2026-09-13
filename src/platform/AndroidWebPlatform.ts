import type { PlaybackCapabilities } from '@machafoundation/core';
import type { Platform, Player } from '@machafoundation/core';
import { WebPlatform } from './WebPlatform';

/** Android TV shell backed by WebView's HTML media pipeline. */
export class AndroidWebPlatform implements Platform {
  readonly name = 'android' as const;
  /**
   * No `forceNativeHls` here, and its removal is the correction of an
   * assumption rather than a new decision.
   *
   * It was set when this file was created, in the commit that first stood the
   * Android target up (`0764d67`, "0.8.1 - Rollup", no body), and never
   * justified: every written reason for forcing the native path in this
   * codebase is about the Samsung — a 2017 Tizen 3 panel on Chromium 47 with
   * no usable MediaSource, where the flag carries thirty lines of measured
   * argument. None of that is true here. The TCL reports WebView
   * 151.0.7922.199, and its own capability probe advertises `hlsFmp4` on the
   * strength of MediaSource being present — which the flag then declined to
   * use, so the client was asking for a container justified by a code path it
   * refused to take.
   *
   * hls.js is the better-trodden path on a modern engine, and it brings
   * something this target has never had: an error channel. `prepareAlternate`
   * is reachable only from `degrade()`, and `degrade()` only from the player's
   * degradation events — which on the native path do not exist. Android has
   * therefore never been able to prepare a warm standby, and pays a full cold
   * start for every recovery.
   */
  private readonly web = new WebPlatform();

  async capabilities(): Promise<PlaybackCapabilities> {
    return { ...await this.web.capabilities(), platform: 'android' };
  }

  createPlayer(): Player {
    return this.web.createPlayer();
  }
}
