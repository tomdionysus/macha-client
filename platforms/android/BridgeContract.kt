package media.macha.client

/** Design stub: a possible Media3/ExoPlayer host implementing the TypeScript Platform and Player contracts. */
interface MachaBridge {
    fun capabilitiesJson(): String
    fun play(playbackSourceJson: String, positionMs: Long): Boolean
    fun pause()
    fun resume()
    fun seek(positionMs: Long)
    fun setVolume(volume: Float)
    fun stop()
}
