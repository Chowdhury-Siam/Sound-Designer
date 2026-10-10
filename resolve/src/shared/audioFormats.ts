// Indexed input formats must also be readable by waveform/FX preparation.
// Actual decoding remains dependent on the embedded runtime's codec support.
export const AUDIO_INPUT_EXTENSIONS = new Set([
  "3g2", "3gp", "aac", "ac3", "adts", "aif", "aiff", "amr", "ape", "au", "bwf", "caf", "dts",
  "flac", "m4a", "m4b", "m4r", "mka", "mp2", "mp3", "mpa", "mpc", "oga", "ogg", "opus", "ra",
  "ram", "snd", "spx", "tak", "tta", "voc", "wav", "weba", "webm", "wma", "wv",
]);
