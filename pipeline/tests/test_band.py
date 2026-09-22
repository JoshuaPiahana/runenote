"""The rule in docs/DECISIONS.md, "The backing is a band, and it plays the
parts you are not playing".

The band is generated, so these tests are about the generator's rules rather
than about one tune: it takes its harmony from the song and its rhythm from
the style table, it never invents harmony the song does not have, and the
file it writes is a real General MIDI file so it can be checked by ear in
anything that plays one.
"""

from __future__ import annotations

from collections.abc import Sequence

import pytest
import yaml
from music21 import chord, meter, midi, note, stream

from runenote import band
from runenote.bundle import midi_bytes

STEADY = """
- id: steady
  name: Steady four
  time: ["4/4"]
  bar: 4
  layers:
    - role: bass
      program: 33
      voicing: root
      range: [36, 47]
      pattern: [0, 2]
      length: 1.75
      velocity: 76
    - role: drums
      length: 0.25
      velocity: 66
      hits:
        36: [0, 2]
"""


def style(text: str = STEADY) -> band.Style:
    return band.styles_from(yaml.safe_load(text))[0]


def song(
    melody: str,
    chords: Sequence[tuple[str, float]],
    time_signature: str = "4/4",
) -> tuple[stream.Part, stream.Part]:
    """A melody of quarter notes over an accompaniment of chords."""
    tune = stream.Part(id="tune")
    tune.insert(0, meter.TimeSignature(time_signature))
    for name in melody.split():
        tune.append(note.Note(name, quarterLength=1))
    left = stream.Part(id="left")
    left.insert(0, meter.TimeSignature(time_signature))
    for pitches, length in chords:
        left.append(chord.Chord(pitches, quarterLength=length))
    return tune.makeMeasures(), left.makeMeasures()


def starts(played: Sequence[band.Strike]) -> list[tuple[float, int]]:
    return [(s.start, s.midi) for s in played]


# --- the style table ------------------------------------------------------


def test_the_shipped_table_loads() -> None:
    styles = band.load_styles()
    assert {s.id for s in styles} >= {"steady", "waltz"}
    for entry in styles:
        assert {layer.role for layer in entry.layers} <= set(band.ROLES)


def test_a_style_must_be_honest_about_the_bar_it_fills() -> None:
    """A groove written in four under a bar of three is not a near miss, it
    is a different piece of music."""
    wrong = STEADY.replace('time: ["4/4"]', 'time: ["3/4"]')
    with pytest.raises(band.StyleError, match=r"fills 3.0 beats, not the 4.0 claimed"):
        style(wrong)


def test_two_styles_may_not_claim_the_same_time_signature() -> None:
    with pytest.raises(band.StyleError, match="same time signature"):
        band.styles_from([*_rows(STEADY), *_rows(STEADY.replace("steady", "second"))])


def test_a_beat_outside_the_bar_is_refused() -> None:
    with pytest.raises(band.StyleError, match=r"beat 4.0 falls outside"):
        style(STEADY.replace("pattern: [0, 2]", "pattern: [0, 4]"))


def test_a_song_no_style_fits_gets_no_band() -> None:
    """Silence is an obvious gap to fill. A waltz under a jig is not."""
    assert band.choose(band.load_styles(), "6/8") is None
    assert band.choose(band.load_styles(), "3/4") is not None


# --- harmony --------------------------------------------------------------


def test_the_chords_come_from_the_accompaniment() -> None:
    _, left = song("C4 C4 C4 C4", [("C3 E3 G3", 2), ("G2 B2 D3", 2)])
    assert [(h.start, h.end, h.root) for h in band.harmony([left])] == [
        (0.0, 2.0, 48),
        (2.0, 4.0, 43),
    ]


def test_a_chord_is_voiced_in_root_position_inside_the_layer_range() -> None:
    bass, keys = _bass_and_keys()
    g_major = band.Harmony(start=0, end=4, root=55, pitches=(55, 59, 62))
    assert band.voice(g_major, bass) == [43]
    assert band.voice(g_major, keys) == [55, 59, 62]
    # The root sets the register, so an inversion in the song is still played
    # as a root-position chord by the band.
    first_inversion = band.Harmony(start=0, end=4, root=48, pitches=(52, 55, 60))
    assert band.voice(first_inversion, keys) == [48, 52, 55]


def test_the_band_takes_the_chords_and_not_the_accompaniment_rhythm() -> None:
    """Two left hands spelling the same harmony differently give the same
    band: what it plays is the song's chords, not the song's texture."""
    held = song("C4 C4 C4 C4", [("C3 E3 G3", 4)])
    repeated = song("C4 C4 C4 C4", [("C3 E3 G3", 1)] * 4)
    steady = style()
    bass = next(layer for layer in steady.layers if layer.role == "bass")
    assert starts(_strikes(bass, held, steady)) == starts(_strikes(bass, repeated, steady))


def test_a_note_is_cut_short_when_the_chord_under_it_changes() -> None:
    """The style asks for 1.75 beats; the chord lasts one, so the note does."""
    parts = song("C4 C4 C4 C4", [("C3 E3 G3", 1), ("G2 B2 D3", 3)])
    steady = style()
    bass = next(layer for layer in steady.layers if layer.role == "bass")
    played = _strikes(bass, parts, steady)
    assert [(s.start, s.midi, s.length) for s in played] == [(0.0, 36, 1.0), (2.0, 43, 1.75)]


def test_where_the_accompaniment_rests_the_harmony_rests_and_the_kit_does_not() -> None:
    """The band follows the song's own texture rather than playing over a
    silence the composer wrote; the pulse is not harmony, so it carries on."""
    tune, left = song("C4 C4 C4 C4", [("C3 E3 G3", 2)])
    steady = style()
    bass = next(layer for layer in steady.layers if layer.role == "bass")
    drums = next(layer for layer in steady.layers if layer.role == "drums")
    chords = band.harmony([left])
    bars = band.bars(tune)
    assert starts(band.strikes(bass, chords, bars, steady.bar)) == [(0.0, 36)]
    assert starts(band.strikes(drums, chords, bars, steady.bar)) == [(0.0, 36), (2.0, 36)]


def test_a_pickup_bar_takes_the_end_of_the_pattern() -> None:
    """A one-beat pickup is the *fourth* beat of a bar, not the first, so the
    groove plays whatever it would have played on beat four and nothing else.
    Getting this wrong puts the downbeat a beat early for the whole song."""
    _, left = song("C4 C4 C4 C4 C4", [("C3 E3 G3", 5)])
    tune = stream.Part(id="tune")
    opening = stream.Measure(number=0)
    opening.insert(0, meter.TimeSignature("4/4"))
    opening.paddingLeft = 3.0
    opening.append(note.Note("C4", quarterLength=1))
    full = stream.Measure(number=1)
    full.append(note.Note("C4", quarterLength=4))
    tune.append([opening, full])
    on_one_and_four = style(STEADY.replace("36: [0, 2]", "36: [0, 3]"))
    drums = next(layer for layer in on_one_and_four.layers if layer.role == "drums")
    bars = band.bars(tune)
    assert bars == [(0.0, 1.0), (1.0, 4.0)]
    played = starts(band.strikes(drums, band.harmony([left]), bars, on_one_and_four.bar))
    # Beat 4 falls in the pickup; beat 1 has no room in it. Then a full bar.
    assert played == [(0.0, 36), (1.0, 36), (4.0, 36)]


# --- the file it writes ---------------------------------------------------


def test_the_drums_are_written_on_the_channel_general_midi_reserves() -> None:
    """Channel 10 is the one thing every synth agrees on, and it is what
    makes backing.mid checkable by ear outside this app."""
    parts = song("C4 C4 C4 C4", [("C3 E3 G3", 4)])
    steady = style()
    score = band.build(parts[0], [parts[1]], steady)
    assert _note_on_channels(midi_bytes(score)) == {0, band.DRUM_CHANNEL}
    assert steady.channels == {"bass": 0, "drums": band.DRUM_CHANNEL}


# --- helpers --------------------------------------------------------------


def _rows(text: str) -> list[object]:
    rows: list[object] = yaml.safe_load(text)
    return rows


def _bass_and_keys() -> tuple[band.Harmonic, band.Harmonic]:
    shipped = band.choose(band.load_styles(), "4/4")
    assert shipped is not None
    layers = {layer.role: layer for layer in shipped.layers}
    bass, keys = layers["bass"], layers["keys"]
    assert isinstance(bass, band.Harmonic) and isinstance(keys, band.Harmonic)
    return bass, keys


def _strikes(
    layer: band.Layer,
    parts: tuple[stream.Part, stream.Part],
    steady: band.Style,
) -> list[band.Strike]:
    tune, left = parts
    return band.strikes(layer, band.harmony([left]), band.bars(tune), steady.bar)


def _note_on_channels(data: bytes) -> set[int]:
    """The channels the written file actually carries notes on, read back
    with a MIDI reader rather than trusted from the code that wrote it."""
    written = midi.MidiFile()
    written.readstr(data)
    return {
        event.channel - 1
        for track in written.tracks
        for event in track.events
        if str(event.type) == "144" and event.parameter2 and event.channel is not None
    }
