package media.macha.client

/**
 * Design stub only. The Android host will implement the TypeScript Platform /
 * Player contracts with Media3/ExoPlayer.
 */
interface MachaBridge {
    fun capabilitiesJson(): String
    fun play(playbackSourceJson: String, positionMs: Long): Boolean
    fun pause()
    fun resume()
    fun seek(positionMs: Long)
    fun stop()
}
