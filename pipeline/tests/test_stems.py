"""A source's own parts as the backing: the rules that keep it honest.

- The backing never plays the melody, nor a part the human dropped.
- Every part but the melody has a role a human confirmed; there is no default.
- What the band stands down from is exactly what the left hand is read from.
- One hand can hold every left-hand chord, however the orchestra spread it.
- The backing moves with the song's key; the drums do not.
- The recorded roles rebuild the same bundle.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from music21 import chord, midi

from fixtures import orchestra
from runenote import bundle, stems
from runenote.arrange import ArrangeError, arrange
from runenote.source import Source, load
from runenote.tiers import load_tiers

REAL_ROOT = Path(__file__).resolve().parents[2]
MELODY = 1


@pytest.fixture
def source(tmp_path: Path) -> Source:
    # Named as a bundle names its copy, so a rebuild reads the same title.
    return load(orchestra.write(tmp_path / "source.mid"))


def played(data: bytes) -> list[tuple[int, int]]:
    """Every note-on in a MIDI file as (channel from 0, pitch)."""
    parsed = midi.MidiFile()
    parsed.readstr(data)
    return [
        (e.channel - 1, e.pitch or 0)
        for t in parsed.tracks
        for e in t.events
        if not e.isDeltaTime() and e.type == midi.ChannelVoiceMessages.NOTE_ON and e.velocity
    ]


def test_parts_are_read_with_their_instruments(source: Source) -> None:
    found = stems.read(source.path)
    assert [(s.name, s.program, s.drums) for s in found] == [
        (t.name, t.program, t.channel == 9) for t in orchestra.PARTS
    ]
    assert len(found) == len(source.score.parts)


def test_suggestions_cover_every_part_but_the_melody(source: Source) -> None:
    suggested = stems.suggest(stems.read(source.path), MELODY)
    assert set(suggested) == {2, 3, 4, 5, 6}
    assert suggested[5] == "drums"
    assert suggested[3] == "bass"


def test_the_backing_never_plays_the_melody_or_a_dropped_part(source: Source) -> None:
    backing = stems.build(source.path, MELODY, orchestra.ROLES, 0)
    assert [t.part for t in backing.tracks] == [2, 3, 4, 5]
    # Exactly the kept parts' notes: neither the melody nor the flute that
    # doubles it adds a single one.
    assert len(played(backing.data)) == sum(len(t.notes) for t in orchestra.PARTS[1:5])
    parsed = midi.MidiFile()
    parsed.readstr(backing.data)
    names = {
        bytes(e.data).decode("latin-1")
        for t in parsed.tracks
        for e in t.events
        if not e.isDeltaTime()
        and e.type == midi.MetaEvents.SEQUENCE_TRACK_NAME
        and isinstance(e.data, bytes)
    }
    assert names == {"Strings", "Contrabass", "Xylophone", "Drums"}


def test_each_part_gets_a_channel_of_its_own_and_its_program(source: Source) -> None:
    backing = stems.build(source.path, MELODY, orchestra.ROLES, 0)
    channels = [t.channel for t in backing.tracks]
    assert len(set(channels)) == len(channels)
    drums = next(t for t in backing.tracks if t.role == "drums")
    assert drums.channel == stems.DRUM_CHANNEL
    assert {t.part: t.program for t in backing.tracks} == {2: 48, 3: 43, 4: 13, 5: 0}
    by_channel = {t.channel: t.part for t in backing.tracks}
    for channel, _ in played(backing.data):
        assert channel in by_channel


def test_every_part_needs_a_confirmed_role(source: Source) -> None:
    partial = {k: v for k, v in orchestra.ROLES.items() if k != 4}
    with pytest.raises(ArrangeError, match=r"parts \[4\] have no role"):
        arrange(source, MELODY, load_tiers(), roles=partial)
    with pytest.raises(ArrangeError, match="is the melody"):
        arrange(source, MELODY, load_tiers(), roles={**orchestra.ROLES, 1: "keys"})
    with pytest.raises(ArrangeError, match="unknown role 'pad'"):
        arrange(source, MELODY, load_tiers(), roles={**orchestra.ROLES, 2: "pad"})


def test_roles_need_a_midi_source(ode: Source) -> None:
    with pytest.raises(ArrangeError, match="need a MIDI source"):
        arrange(ode, 1, load_tiers(), roles={2: "keys"})


def test_the_bass_line_level_reads_the_bass_part(source: Source) -> None:
    arrangement = arrange(source, MELODY, load_tiers(), roles=orchestra.ROLES)
    tier = next(t for t in arrangement.tiers if t.tier.layers == {"melody", "bass"})
    left = tier.score.parts[1]
    shift = arrangement.semitones
    assert [p.midi for n in left.flatten().notes for p in n.pitches] == [
        p + shift for _, _, p in orchestra.BASS.notes
    ]


def test_the_harmony_level_is_the_orchestras_chords_in_one_hand(source: Source) -> None:
    arrangement = arrange(source, MELODY, load_tiers(), roles=orchestra.ROLES)
    tier = next(t for t in arrangement.tiers if "harmony" in t.tier.layers)
    left = tier.score.parts[1]
    flat = left.flatten()
    shift = arrangement.semitones
    sounding = orchestra.STRINGS.notes + orchestra.BASS.notes
    for n in flat.notes:
        midis = [p.midi for p in n.pitches]
        # One hand: the bass and at most two above it, inside an octave.
        assert len(midis) <= 3
        assert max(midis) - min(midis) <= 12
        # Only what the bass and the keys are sounding at that moment: the
        # echo (colour) and the melody never reach the left hand.
        at = float(flat.elementOffset(n))
        heard = {(p + shift) % 12 for s, length, p in sounding if s <= at < s + length}
        assert {m % 12 for m in midis} <= heard
    assert any(isinstance(n, chord.Chord) for n in flat.notes)


def test_the_backing_moves_with_the_key_and_the_drums_do_not(tmp_path: Path) -> None:
    # Written with four sharps (E major) and played in it, so the tiers move.
    up = [
        orchestra.Track(
            t.name,
            t.channel,
            t.program,
            [(s, n, p if t.channel == 9 else p + 9) for s, n, p in t.notes],
        )
        for t in orchestra.PARTS
    ]
    source = load(orchestra.write(tmp_path / "e.mid", up, sharps=4))
    arrangement = arrange(source, MELODY, load_tiers(), roles=orchestra.ROLES)
    assert arrangement.semitones != 0
    backing = arrangement.backing
    assert isinstance(backing, stems.StemBacking)
    channel_of = {t.part: t.channel for t in backing.tracks}
    notes = played(backing.data)
    bass = [p for c, p in notes if c == channel_of[3]]
    assert bass == [p + 9 + arrangement.semitones for _, _, p in orchestra.BASS.notes]
    drums = [p for c, p in notes if c == stems.DRUM_CHANNEL]
    assert drums == [p for _, _, p in orchestra.DRUMS.notes]


def test_the_recorded_roles_rebuild_the_same_bundle(source: Source, tmp_path: Path) -> None:
    choices = bundle.Choices(song_id="orchestra", melody=MELODY, licence="x", roles=orchestra.ROLES)
    arrangement = arrange(source, MELODY, load_tiers(), roles=orchestra.ROLES)
    first = tmp_path / "first"
    song = bundle.write(arrangement, source, choices, first, schema_root=REAL_ROOT)
    assert song["source"]["roles"] == {str(k): v for k, v in orchestra.ROLES.items()}
    assert song["backing"]["from"] == "source"
    assert "style" not in song["backing"]

    again = tmp_path / "again"
    bundle.rebuild(first, again, schema_root=REAL_ROOT)
    for name in ["song.json", "backing.mid", *(t["file"] for t in song["tiers"])]:
        assert (again / name).read_bytes() == (first / name).read_bytes(), name
    assert json.loads((again / "song.json").read_text(encoding="utf-8")) == song
