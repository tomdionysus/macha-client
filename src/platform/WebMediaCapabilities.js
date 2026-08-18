function anySupported(probe, mimeTypes) {
    return mimeTypes.some((mime) => probe(mime));
}
export function detectWebMediaCodecCapabilities(probe) {
    const videoCodecs = [];
    if (probe('video/mp4; codecs="avc1.42E01E"'))
        videoCodecs.push('h264');
    if (anySupported(probe, [
        'video/mp4; codecs="hev1.1.6.L93.B0"',
        'video/mp4; codecs="hvc1.1.6.L93.B0"',
    ]))
        videoCodecs.push('hevc');
    if (probe('video/webm; codecs="vp9"'))
        videoCodecs.push('vp9');
    if (probe('video/mp4; codecs="av01.0.05M.08"'))
        videoCodecs.push('av1');
    const audioCodecs = [];
    if (anySupported(probe, [
        'audio/mp4; codecs="mp4a.40.2"',
        'video/mp4; codecs="mp4a.40.2"',
    ]))
        audioCodecs.push('aac');
    if (anySupported(probe, [
        'audio/webm; codecs="opus"',
        'video/webm; codecs="opus"',
    ]))
        audioCodecs.push('opus');
    if (probe('audio/ogg; codecs="vorbis"'))
        audioCodecs.push('vorbis');
    // ISO BMFF/fMP4 codec identifiers are the important probes for Macha's
    // remux path. Raw MIME names are retained as compatibility fallbacks for
    // browsers which expose Dolby support that way.
    if (anySupported(probe, [
        'audio/mp4; codecs="ac-3"',
        'video/mp4; codecs="ac-3"',
        'audio/ac3',
        'audio/x-ac3',
    ]))
        audioCodecs.push('ac3');
    if (anySupported(probe, [
        'audio/mp4; codecs="ec-3"',
        'video/mp4; codecs="ec-3"',
        'audio/eac3',
        'audio/x-eac3',
    ]))
        audioCodecs.push('eac3');
    if (probe('audio/mpeg'))
        audioCodecs.push('mp3');
    if (probe('audio/flac'))
        audioCodecs.push('flac');
    const containers = [];
    if (probe('video/mp4') || probe('audio/mp4'))
        containers.push('mp4');
    if (probe('video/webm') || probe('audio/webm'))
        containers.push('webm');
    if (probe('audio/mpeg'))
        containers.push('mp3');
    if (probe('audio/flac'))
        containers.push('flac');
    if (probe('audio/ogg'))
        containers.push('ogg');
    return { videoCodecs, audioCodecs, containers };
}
