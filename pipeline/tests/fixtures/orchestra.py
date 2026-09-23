"""A small sequenced orchestration, written as raw MIDI the way VGMusic's are.

One track per instrument, each on its own channel with its own General MIDI
program, drums on channel 10, and the default key signature a sequencer
writes (no sharps) over music that is plainly in G major. Every trait the
source-backing path has to cope with, in eight bars of 3/4.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from music21 import midi

TPQ = 480


@dataclass
class Track:
    name: str
    channel: int
    """From 0, as song.json counts; 9 is percussion."""
    program: int
    notes: list[tuple[float, float, int]] = field(default_factory=list)
    """(start, length, MIDI pitch), in quarter notes."""


def bars(
    pattern: list[tuple[float, float, int]], count: int, bar: float = 3.0
) -> list[tuple[float, float, int]]:
    return [(start + n * bar, length, p) for n in range(count) for start, length, p in pattern]


MELODY = Track(
    "Ocarina",
    0,
    79,
    [
        (0, 1, 71),
        (1, 1, 74),
        (2, 1, 69),  # B D A
        (3, 2, 67),
        (5, 1, 69),  # G A
        (6, 1, 71),
        (7, 1, 74),
        (8, 1, 69),
        (9, 3, 66),  # F#
        (12, 1, 71),
        (13, 1, 74),
        (14, 1, 76),
        (15, 2, 74),
        (17, 1, 72),
        (18, 1, 71),
        (19, 1, 69),
        (20, 1, 66),
        (21, 3, 67),
    ],
)
# Wide, the way an orchestra voices it: no hand could hold these as written.
STRINGS = Track(
    "Strings",
    1,
    48,
    [
        (0, 6, 55),
        (0, 6, 62),
        (0, 6, 71),  # G: G3 D4 B4
        (6, 6, 50),
        (6, 6, 66),
        (6, 6, 69),  # D: D3 F#4 A4
        (12, 6, 48),
        (12, 6, 64),
        (12, 6, 67),  # C: C3 E4 G4
        (18, 3, 50),
        (18, 3, 66),
        (18, 3, 72),  # D7: D3 F#4 C5
        (21, 3, 55),
        (21, 3, 62),
        (21, 3, 71),  # G
    ],
)
BASS = Track(
    "Contrabass",
    2,
    43,
    [
        (0, 3, 43),
        (3, 3, 43),
        (6, 3, 38),
        (9, 3, 38),
        (12, 3, 36),
        (15, 3, 36),
        (18, 3, 38),
        (21, 3, 43),
    ],
)
ECHO = Track("Xylophone", 3, 13, [(2.5, 0.5, 83), (8.5, 0.5, 81), (14.5, 0.5, 88)])
DRUMS = Track("Drums", 9, 0, bars([(0, 0.5, 42), (1, 0.5, 42), (2, 0.5, 42)], 8))
DOUBLE = Track("Flute", 4, 73, [(s, length, p) for s, length, p in MELODY.notes])

PARTS = [MELODY, STRINGS, BASS, ECHO, DRUMS, DOUBLE]
"""In part order: the melody is part 1, the strings 2, and so on."""
ROLES = {2: "keys", 3: "bass", 4: "colour", 5: "drums", 6: "drop"}


def write(
    path: Path,
    tracks: list[Track] | None = None,
    *,
    signatures: list[tuple[float, int, int]] | None = None,
    sharps: int = 0,
    bpm: float = 100,
) -> Path:
    """Write a format 1 MIDI file: a conductor track, then one per Track.
    ``signatures`` are (where, numerator, denominator); default one bar of 3/4."""
    out = midi.MidiFile()
    out.format = 1
    out.ticksPerQuarterNote = TPQ
    conductor = midi.MidiTrack(0)
    meta: list[tuple[int, midi.MidiEvent]] = []
    for at, num, den in signatures or [(0.0, 3, 4)]:
        ts = midi.MidiEvent(conductor, type=midi.MetaEvents.TIME_SIGNATURE)
        ts.data = bytes([num, den.bit_length() - 1, 24, 8])
        meta.append((round(at * TPQ), ts))
    ks = midi.MidiEvent(conductor, type=midi.MetaEvents.KEY_SIGNATURE)
    ks.data = bytes([sharps & 0xFF, 0])
    tempo = midi.MidiEvent(conductor, type=midi.MetaEvents.SET_TEMPO)
    tempo.data = round(60_000_000 / bpm).to_bytes(3, "big")
    meta += [(0, ks), (0, tempo)]
    _fill(conductor, sorted(meta, key=lambda m: m[0]))
    out.tracks.append(conductor)

    for index, track in enumerate(tracks if tracks is not None else PARTS, start=1):
        written = midi.MidiTrack(index)
        events: list[tuple[int, midi.MidiEvent]] = []
        name = midi.MidiEvent(written, type=midi.MetaEvents.SEQUENCE_TRACK_NAME)
        name.data = track.name.encode("latin-1")
        events.append((0, name))
        if track.channel != 9:
            program = midi.MidiEvent(
                written, type=midi.ChannelVoiceMessages.PROGRAM_CHANGE, channel=track.channel + 1
            )
            program.data = track.program
            events.append((0, program))
        for start, length, pitch in track.notes:
            for tick, velocity in ((start, 90), (start + length, 0)):
                event = midi.MidiEvent(
                    written, type=midi.ChannelVoiceMessages.NOTE_ON, channel=track.channel + 1
                )
                event.pitch = pitch
                event.velocity = velocity
                events.append((round(tick * TPQ), event))
        # Note-offs before note-ons at the same tick, as sequencers write them.
        events.sort(key=lambda e: (e[0], e[1].velocity != 0 if e[1].velocity is not None else 0))
        _fill(written, events)
        out.tracks.append(written)

    path.write_bytes(bytes(out.writestr()))
    return path


def _fill(track: midi.MidiTrack, events: list[tuple[int, midi.MidiEvent]]) -> None:
    last = 0
    for tick, event in events:
        track.events += [midi.DeltaTime(track, time=tick - last), event]
        last = tick
    end = midi.MidiEvent(track, type=midi.MetaEvents.END_OF_TRACK)
    end.data = b""
    track.events += [midi.DeltaTime(track, time=0), end]
    track.updateEvents()
