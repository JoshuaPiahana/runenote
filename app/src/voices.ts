// Which recorded instrument plays each General MIDI program.
//
// A source backing names its instruments, a harp and a string section, and
// the band used to play every one of them on the same few oscillators, so a
// seven-part arrangement sounded like three. The samples are the FluidR3
// General MIDI set as rendered by the midi-js-soundfonts project (Creative
// Commons Attribution 3.0, credited in the README). The browser fetches one
// the first time a song needs it and keeps it; none of them enter the
// repository. One instrument is 2-3 MB, so only the ones a song names load.
//
// General MIDI's drum kit is not one of its 128 programs and this set has
// none, so the drums stay synthesised.

/** Where the instruments are fetched from, one file per program. */
export const SAMPLE_BASE = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/";

/** FluidR3's name for each General MIDI program, in program order from 0. */
// biome-ignore format: a table reads four to a line
export const GM_NAMES: readonly string[] = [
  "acoustic_grand_piano", "bright_acoustic_piano", "electric_grand_piano", "honkytonk_piano",
  "electric_piano_1", "electric_piano_2", "harpsichord", "clavinet",
  "celesta", "glockenspiel", "music_box", "vibraphone",
  "marimba", "xylophone", "tubular_bells", "dulcimer",
  "drawbar_organ", "percussive_organ", "rock_organ", "church_organ",
  "reed_organ", "accordion", "harmonica", "tango_accordion",
  "acoustic_guitar_nylon", "acoustic_guitar_steel", "electric_guitar_jazz", "electric_guitar_clean",
  "electric_guitar_muted", "overdriven_guitar", "distortion_guitar", "guitar_harmonics",
  "acoustic_bass", "electric_bass_finger", "electric_bass_pick", "fretless_bass",
  "slap_bass_1", "slap_bass_2", "synth_bass_1", "synth_bass_2",
  "violin", "viola", "cello", "contrabass",
  "tremolo_strings", "pizzicato_strings", "orchestral_harp", "timpani",
  "string_ensemble_1", "string_ensemble_2", "synth_strings_1", "synth_strings_2",
  "choir_aahs", "voice_oohs", "synth_choir", "orchestra_hit",
  "trumpet", "trombone", "tuba", "muted_trumpet",
  "french_horn", "brass_section", "synth_brass_1", "synth_brass_2",
  "soprano_sax", "alto_sax", "tenor_sax", "baritone_sax",
  "oboe", "english_horn", "bassoon", "clarinet",
  "piccolo", "flute", "recorder", "pan_flute",
  "blown_bottle", "shakuhachi", "whistle", "ocarina",
  "lead_1_square", "lead_2_sawtooth", "lead_3_calliope", "lead_4_chiff",
  "lead_5_charang", "lead_6_voice", "lead_7_fifths", "lead_8_bass__lead",
  "pad_1_new_age", "pad_2_warm", "pad_3_polysynth", "pad_4_choir",
  "pad_5_bowed", "pad_6_metallic", "pad_7_halo", "pad_8_sweep",
  "fx_1_rain", "fx_2_soundtrack", "fx_3_crystal", "fx_4_atmosphere",
  "fx_5_brightness", "fx_6_goblins", "fx_7_echoes", "fx_8_scifi",
  "sitar", "banjo", "shamisen", "koto",
  "kalimba", "bagpipe", "fiddle", "shanai",
  "tinkle_bell", "agogo", "steel_drums", "woodblock",
  "taiko_drum", "melodic_tom", "synth_drum", "reverse_cymbal",
  "guitar_fret_noise", "breath_noise", "seashore", "bird_tweet",
  "telephone_ring", "helicopter", "applause", "gunshot",
];

/** The General MIDI program the player's own notes are sounded with. */
export const PIANO = 0;

/** The sample file for a General MIDI program, or undefined if it is not one. */
export function sampleUrl(program: number): string | undefined {
  const name = GM_NAMES[program];
  return name ? `${SAMPLE_BASE}${name}-ogg.js` : undefined;
}
