"""The source's own parts, played as the backing.

A fan orchestration of a game tune (VGMusic's, say) is a band already: the
melody on one track and strings, harp, bass and drums on the others, each
with its own instrument. Generating a band from its harmony would throw that
away for three synthesised roles, so for such a source the backing *is* the
source, minus the melody.

That is only honest because every part is given a role, the same roles the
generated band has, and the app mutes by role. The objection to shipping
leftovers was never about where the notes came from; it was that on a piano
source the leftovers are the left hand, which the player takes over, so the
app would play the player's part back at them. A role per part keeps the rule
("the band plays the parts you are not playing") and lets the orchestra stay:

- ``bass``: stands down when the player's left hand takes the bass line.
- ``keys``: the harmony. Stands down when the player plays the chords.
- ``drums``: never the player's; always plays.
- ``colour``: counter-melodies, arpeggios, echoes: texture the player's hands
  never reproduce. Always plays.
- ``drop``: left out of the backing altogether (a part doubling the melody,
  say).

The left hand is read from the same roles (see ``arrange``), so what the band
stops playing is exactly what the player starts playing.

The notes are copied as raw MIDI events rather than through music21, so the
drums, velocities, expression and pedalling arrive as the arranger sequenced
them. Only two things change: each part gets a channel of its own, because
the app knows a role by its channel, and pitched notes move with the song
when it is transposed to its playing key.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from statistics import fmean
from typing import Literal, get_args

from music21 import midi

StemRole = Literal["bass", "keys", "drums", "colour", "drop"]
STEM_ROLES: tuple[str, ...] = get_args(StemRole)

# General MIDI's percussion channel, counted from 0 as song.json counts them.
# music21's MidiEvent counts from 1, which is the only place that shows.
DRUM_CHANNEL = 9
# Below this mean pitch (D3) a part is suggested as the bass.
BASS_BELOW = 50.0

_NOTE_EVENTS = (midi.ChannelVoiceMessages.NOTE_ON, midi.ChannelVoiceMessages.NOTE_OFF)
_TRACK_WIDE_META = (
    midi.MetaEvents.SET_TEMPO,
    midi.MetaEvents.TIME_SIGNATURE,
    midi.MetaEvents.KEY_SIGNATURE,
)


class StemError(Exception):
    """The source cannot be used as a backing as it stands; the message says why."""


@dataclass(frozen=True)
class Stem:
    """One of the source's tracks that has notes: a part, as the arranger numbers them."""

    part: int
    """1-based, the same number the melody is chosen by."""
    name: str
    program: int
    """General MIDI program, from 0; 0 when the track sets none."""
    drums: bool
    notes: int
    mean_pitch: float


@dataclass(frozen=True)
class StemTrack:
    """A part as it ends up in the backing, and what song.json says about it."""

    part: int
    role: str
    channel: int
    program: int


@dataclass(frozen=True)
class StemBacking:
    tracks: list[StemTrack]
    data: bytes
    """The backing MIDI file."""


def read(path: Path) -> list[Stem]:
    """The source's tracks that have notes, numbered as the arranger's parts."""
    return [_stem(number, track) for number, track in enumerate(_note_tracks(_open(path)), 1)]


def suggest(stems: Sequence[Stem], melody: int) -> dict[int, str]:
    """A role for every part but the melody. A guess, for a human to confirm,
    as the melody is: percussion is certain, the rest is register."""
    tune = next((s for s in stems if s.part == melody), None)
    above = tune.mean_pitch if tune is not None else 128.0
    roles: dict[int, str] = {}
    for stem in stems:
        if stem.part == melody:
            continue
        if stem.drums:
            roles[stem.part] = "drums"
        elif stem.mean_pitch < BASS_BELOW:
            roles[stem.part] = "bass"
        elif stem.mean_pitch > above:
            roles[stem.part] = "colour"
        else:
            roles[stem.part] = "keys"
    return roles


def check(stems: Sequence[Stem], melody: int, roles: Mapping[int, str]) -> None:
    """Every part but the melody has exactly one known role, and no other."""
    parts = {s.part for s in stems}
    for part, role in roles.items():
        if part == melody:
            msg = f"part {part} is the melody; it cannot also have a backing role"
            raise StemError(msg)
        if part not in parts:
            msg = f"no part {part}; the source's parts are {sorted(parts)}"
            raise StemError(msg)
        if role not in STEM_ROLES:
            msg = f"part {part}: unknown role {role!r}; known roles are {list(STEM_ROLES)}"
            raise StemError(msg)
    missing = sorted(parts - {melody} - set(roles))
    if missing:
        msg = f"parts {missing} have no role; every part but the melody needs one"
        raise StemError(msg)


def build(path: Path, melody: int, roles: Mapping[int, str], semitones: int) -> StemBacking:
    """The backing: the source with the melody and the dropped parts taken out,
    every part on a channel of its own, pitched notes moved by ``semitones``."""
    source = _open(path)
    stems = read(path)
    check(stems, melody, roles)
    by_part = dict(enumerate(_note_tracks(source), 1))

    out = midi.MidiFile()
    out.format = 1
    out.ticksPerQuarterNote = source.ticksPerQuarterNote
    # Tracks without notes carry the tempo, metre and names; they stay, less
    # any channel messages, which would now land on some other part's channel.
    for track in source.tracks:
        if not _has_notes(track):
            out.tracks.append(_copied(track, len(out.tracks), keep_channel_events=False))

    free = (c for c in range(16) if c != DRUM_CHANNEL)
    tracks: list[StemTrack] = []
    for stem in stems:
        role = roles.get(stem.part)
        if stem.part == melody or role == "drop" or role is None:
            continue
        if stem.drums:
            channel = DRUM_CHANNEL
        else:
            channel = next(free, -1)
            if channel < 0:
                msg = f"{path}: more pitched parts than MIDI has channels for"
                raise StemError(msg)
        track = _copied(by_part[stem.part], len(out.tracks), keep_channel_events=True)
        _rechannel(track, channel, 0 if stem.drums else semitones, stem.program)
        out.tracks.append(track)
        tracks.append(StemTrack(stem.part, role, channel, stem.program))

    if not tracks:
        msg = f"{path}: every part but the melody is dropped; there is no backing left"
        raise StemError(msg)
    return StemBacking(tracks=tracks, data=bytes(out.writestr()))


# --- raw MIDI ------------------------------------------------------------


def _open(path: Path) -> midi.MidiFile:
    source = midi.MidiFile()
    source.open(str(path))
    try:
        source.read()
    finally:
        source.close()
    return source


def _has_notes(track: midi.MidiTrack) -> bool:
    return any(_is_note_on(e) for e in track.events)


def _note_tracks(source: midi.MidiFile) -> list[midi.MidiTrack]:
    tracks = [t for t in source.tracks if _has_notes(t)]
    for number, track in enumerate(tracks, 1):
        channels = {e.channel for e in track.events if _is_note_on(e)}
        if len(channels) > 1:
            # A single-track (format 0) file puts every instrument on one
            # track; music21 reads it as one part, so the melody could not be
            # told from the rest. Splitting by channel would fix it; no
            # source has needed it yet.
            msg = (
                f"part {number} plays on channels {sorted(channels)}; one track per part is needed"
            )
            raise StemError(msg)
    return tracks


def _is_channel_event(event: midi.MidiEvent) -> bool:
    return isinstance(event.type, midi.ChannelVoiceMessages | midi.ChannelModeMessages)


def _is_note_on(event: midi.MidiEvent) -> bool:
    return (
        not event.isDeltaTime()
        and event.type == midi.ChannelVoiceMessages.NOTE_ON
        and bool(event.velocity)
    )


def _stem(number: int, track: midi.MidiTrack) -> Stem:
    name, program, pitches, drums = "", 0, [], False
    for event in track.events:
        if event.isDeltaTime():
            continue
        if event.type == midi.MetaEvents.SEQUENCE_TRACK_NAME and not name:
            name = event.data.decode("latin-1").strip() if isinstance(event.data, bytes) else ""
        elif event.type == midi.ChannelVoiceMessages.PROGRAM_CHANGE and not program:
            program = event.data if isinstance(event.data, int) else 0
        elif _is_note_on(event):
            pitches.append(event.pitch or 0)
            drums = event.channel - 1 == DRUM_CHANNEL
    return Stem(
        part=number,
        name=name or f"part {number}",
        program=program,
        drums=drums,
        notes=len(pitches),
        mean_pitch=fmean(pitches),
    )


def _copied(track: midi.MidiTrack, index: int, *, keep_channel_events: bool) -> midi.MidiTrack:
    """A copy of a track's events, delta times re-added so the time between
    what is kept stays the same whatever is left out."""
    copied = midi.MidiTrack(index)
    tick, last = 0, 0
    for event in track.events:
        if event.isDeltaTime():
            tick += event.time
            continue
        if _is_channel_event(event) and not keep_channel_events:
            continue
        # One conductor is enough: a tempo in a part's track would fight it.
        # And a part's own program changes may sit anywhere or nowhere; the
        # one written at its start (see _rechannel) is the one that counts.
        if keep_channel_events and (
            event.type in _TRACK_WIDE_META or event.type == midi.ChannelVoiceMessages.PROGRAM_CHANGE
        ):
            continue
        kept = copy.copy(event)
        kept.track = copied
        delta = midi.DeltaTime(copied, time=tick - last)
        copied.events.extend([delta, kept])
        last = tick
    copied.updateEvents()
    return copied


def _rechannel(track: midi.MidiTrack, channel: int, semitones: int, program: int) -> None:
    for event in track.events:
        if event.isDeltaTime():
            continue
        if _is_channel_event(event):
            event.channel = channel + 1
        if semitones and event.type in _NOTE_EVENTS:
            moved = (event.pitch or 0) + semitones
            if not 0 <= moved <= 127:
                msg = f"transposing by {semitones:+d} takes a note off the MIDI range"
                raise StemError(msg)
            event.pitch = moved
    # A program change at the start makes the part's instrument explicit for
    # any synth, whatever the source did.
    if channel != DRUM_CHANNEL:
        change = midi.MidiEvent(
            track, type=midi.ChannelVoiceMessages.PROGRAM_CHANGE, channel=channel + 1
        )
        change.data = program
        track.events[0:0] = [midi.DeltaTime(track, time=0), change]
    track.updateEvents()
