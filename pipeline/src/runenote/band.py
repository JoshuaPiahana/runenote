"""The band: a backing generated from the song's harmony, not left over from it.

The arranger splits a source into the melody and everything else. It would be
easy to call "everything else" the backing and ship it, but that is not an
accompaniment: on a piano source it is the left hand, which is exactly what
the player's own hands take over at the higher levels, so the app would be
playing the player's part back at them over the top of their mistakes.

So the leftover parts are read for their *harmony* and a band is generated
from it: a bass, something comping the chords, and a kit. Which instruments,
which groove and which register is the style table's business
(``styles.yaml``), the same way the difficulty ladder is tiers.yaml's, so it
can be re-tuned without touching code.

The band never plays the melody, and every role it does play is one the app
can mute when the player's own level takes that role on. You are always the
part that is missing.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from importlib import resources
from typing import Any, Literal

import yaml
from music21 import chord, instrument, meter, note, stream

# General MIDI reserves this channel for percussion and every synth agrees,
# which is the only reason a drum track is portable at all.
DRUM_CHANNEL = 9
ROLES: tuple[str, ...] = ("bass", "keys", "drums")


class StyleError(Exception):
    """The style table is not usable; the message says which row and why."""


@dataclass(frozen=True)
class Harmonic:
    """A layer that follows the chords: the bass, or keys comping them."""

    role: str
    program: int
    """General MIDI program, numbered from 0."""
    velocity: int
    pattern: tuple[float, ...]
    """Beats from the start of the bar, in quarter notes."""
    length: float
    voicing: Literal["root", "chord"]
    low: int
    high: int


@dataclass(frozen=True)
class Kit:
    """The drums: a groove, with no harmony to follow."""

    role: str
    velocity: int
    length: float
    hits: tuple[tuple[int, tuple[float, ...]], ...]
    """(General MIDI percussion note, the beats it is struck on)."""


Layer = Harmonic | Kit


@dataclass(frozen=True)
class Style:
    id: str
    name: str
    time: tuple[str, ...]
    """The time signatures this style fits; how it is matched to a song."""
    bar: float
    """Length of a bar in quarter notes. Everything else counts in those too."""
    layers: tuple[Layer, ...]

    @property
    def channels(self) -> dict[str, int]:
        """Which MIDI channel each role is written on. Percussion's is fixed
        by the standard; the rest take the next one free."""
        free = (c for c in range(16) if c != DRUM_CHANNEL)
        return {
            layer.role: DRUM_CHANNEL if isinstance(layer, Kit) else next(free)
            for layer in sorted(self.layers, key=lambda x: isinstance(x, Kit))
        }


@dataclass(frozen=True)
class Harmony:
    """One chord of the song, and how long it lasts."""

    start: float
    end: float
    root: int
    pitches: tuple[int, ...]


@dataclass(frozen=True)
class Strike:
    """One note the band plays."""

    start: float
    length: float
    midi: int
    velocity: int


# --- the style table ------------------------------------------------------


def load_styles() -> list[Style]:
    text = resources.files(__package__).joinpath("styles.yaml").read_text(encoding="utf-8")
    return styles_from(yaml.safe_load(text))


def styles_from(rows: Any) -> list[Style]:
    if not isinstance(rows, list) or not rows:
        msg = "the style table must be a non-empty list"
        raise StyleError(msg)
    styles = [_style(row) for row in rows]
    claimed = [signature for style in styles for signature in style.time]
    if len(set(claimed)) != len(claimed):
        msg = f"two styles claim the same time signature: {sorted(claimed)}"
        raise StyleError(msg)
    return styles


def choose(styles: Sequence[Style], time_signature: str) -> Style | None:
    """The style for a song in this time signature, or None. No band is
    better than the wrong one: a waltz under a jig is worse than silence,
    and silence is obviously a gap waiting to be filled.
    """
    return next((s for s in styles if time_signature in s.time), None)


def _style(row: Any) -> Style:
    try:
        style = Style(
            id=row["id"],
            name=row["name"],
            time=tuple(str(t) for t in row["time"]),
            bar=float(row["bar"]),
            layers=tuple(_layer(row["id"], layer) for layer in row["layers"]),
        )
    except (KeyError, TypeError, ValueError) as error:
        msg = f"style row {row!r} is not usable: {error}"
        raise StyleError(msg) from error
    for signature in style.time:
        length = float(meter.TimeSignature(signature).barDuration.quarterLength)
        if length != style.bar:
            msg = f"style {style.id}: {signature} fills {length} beats, not the {style.bar} claimed"
            raise StyleError(msg)
    roles = [layer.role for layer in style.layers]
    if len(set(roles)) != len(roles):
        msg = f"style {style.id}: two layers claim the same role ({sorted(roles)})"
        raise StyleError(msg)
    for layer in style.layers:
        for beat in _beats(layer):
            if not 0 <= beat < style.bar:
                msg = f"style {style.id}: beat {beat} falls outside a {style.bar}-beat bar"
                raise StyleError(msg)
    return style


def _layer(style_id: str, row: Any) -> Layer:
    role = row.get("role")
    if role not in ROLES:
        msg = f"style {style_id}: unknown role {role!r}; known roles are {list(ROLES)}"
        raise StyleError(msg)
    if "hits" in row:
        return Kit(
            role=role,
            velocity=int(row["velocity"]),
            length=float(row["length"]),
            hits=tuple(
                (int(drum), tuple(float(b) for b in beats)) for drum, beats in row["hits"].items()
            ),
        )
    voicing = row["voicing"]
    if voicing not in ("root", "chord"):
        msg = f"style {style_id}: {role} has unknown voicing {voicing!r}"
        raise StyleError(msg)
    low, high = (int(x) for x in row["range"])
    if high - low < 11:
        msg = f"style {style_id}: {role}'s range {low}-{high} is under an octave; a root may "
        msg += "not fit in it"
        raise StyleError(msg)
    return Harmonic(
        role=role,
        program=int(row["program"]),
        velocity=int(row["velocity"]),
        pattern=tuple(float(b) for b in row["pattern"]),
        length=float(row["length"]),
        voicing=voicing,
        low=low,
        high=high,
    )


def _beats(layer: Layer) -> Iterator[float]:
    if isinstance(layer, Kit):
        return (beat for _, beats in layer.hits for beat in beats)
    return iter(layer.pattern)


# --- the song's harmony ---------------------------------------------------


def harmony(parts: Sequence[stream.Part]) -> list[Harmony]:
    """The chords the accompaniment spells out, in order.

    Where it rests there is no chord, and the band's harmonic layers rest
    with it: the band follows the song's own texture rather than inventing
    one over the top of a silence the composer wrote.
    """
    if not parts:
        return []
    merged = stream.Score()
    for part in parts:
        merged.insert(0, part)
    chords: list[Harmony] = []
    for element in merged.chordify().flatten().getElementsByClass(chord.Chord):
        pitches = tuple(sorted({p.midi for p in element.pitches}))
        if not pitches:
            continue
        root = element.root()
        start = float(element.offset)
        chords.append(
            Harmony(
                start=start,
                end=start + float(element.quarterLength),
                root=root.midi if root is not None else pitches[0],
                pitches=pitches,
            )
        )
    return chords


def sounding(chords: Sequence[Harmony], when: float) -> Harmony | None:
    """The chord in force at a moment, if there is one."""
    return next((c for c in chords if c.start <= when < c.end), None)


def voice(sounded: Harmony, layer: Harmonic) -> list[int]:
    """The notes a harmonic layer plays for one chord.

    The root is placed at the bottom of the layer's range and the rest of the
    chord is stacked above it, so every chord comes out in root position and
    the band's register never wanders off up the keyboard.
    """
    root = layer.low + (sounded.root - layer.low) % 12
    if root > layer.high:
        root -= 12
    if layer.voicing == "root":
        return [root]
    return sorted({root + (midi - root) % 12 for midi in sounded.pitches})


# --- building it ----------------------------------------------------------


def bars(part: stream.Part) -> list[tuple[float, float]]:
    """Each bar of a part as (where it starts, how long it actually is), read
    from the score so a short pickup bar is honest about being one."""
    found: list[tuple[float, float]] = []
    for offset, measures in sorted(part.measureOffsetMap().items()):
        if measures:
            found.append((float(offset), float(measures[0].duration.quarterLength)))
    return found


def strikes(
    layer: Layer,
    chords: Sequence[Harmony],
    song_bars: Sequence[tuple[float, float]],
    bar: float,
) -> list[Strike]:
    """Every note one layer plays, over the whole song."""
    end = max((start + length for start, length in song_bars), default=0.0)
    played: list[Strike] = []
    for bar_start, bar_length in song_bars:
        # A short bar is a pickup, so the groove takes the *end* of the
        # pattern: what would have been beat 4 of a full bar lands on the one
        # beat the pickup actually has, and the band comes in on the beat the
        # bar really is rather than a beat early.
        shift = bar - bar_length
        for beat, midis, velocity, length in _bar_of(layer, chords, bar_start, shift):
            held = min(length, end - beat)
            if held <= 0:
                continue
            played.extend(Strike(beat, held, midi, velocity) for midi in midis)
    played.sort(key=lambda s: (s.start, s.midi))
    return played


def _bar_of(
    layer: Layer,
    chords: Sequence[Harmony],
    bar_start: float,
    shift: float,
) -> Iterator[tuple[float, list[int], int, float]]:
    if isinstance(layer, Kit):
        for drum, beats in layer.hits:
            for beat in beats:
                if beat >= shift:
                    yield bar_start + beat - shift, [drum], layer.velocity, layer.length
        return
    for beat in layer.pattern:
        if beat < shift:
            continue
        at = bar_start + beat - shift
        sounded = sounding(chords, at)
        if sounded is None:
            continue
        # Cut short when the chord under it changes, so the table never has to
        # know the song's harmonic rhythm.
        yield at, voice(sounded, layer), layer.velocity, min(layer.length, sounded.end - at)


def build(
    melody: stream.Part,
    accompaniment: Sequence[stream.Part],
    style: Style,
) -> stream.Score:
    """The band for one song: one part per role, played over the melody's bars."""
    chords = harmony(accompaniment)
    song_bars = bars(melody)
    channels = style.channels
    score = stream.Score()
    for layer in style.layers:
        part = stream.Part(id=layer.role)
        part.partName = layer.role.title()
        part.insert(0, _instrument(layer, channels[layer.role]))
        for played in strikes(layer, chords, song_bars, style.bar):
            part.insert(played.start, _note(played))
        score.insert(0, part)
    return score


def _instrument(layer: Layer, channel: int) -> instrument.Instrument:
    if isinstance(layer, Kit):
        kit = instrument.Percussion()
        kit.instrumentName = "Drums"
        kit.midiChannel = channel
        return kit
    voiced = instrument.instrumentFromMidiProgram(layer.program)
    voiced.midiChannel = channel
    voiced.midiProgram = layer.program
    return voiced


def _note(played: Strike) -> note.Note:
    sounded = note.Note(played.midi)
    sounded.quarterLength = played.length
    sounded.volume.velocity = played.velocity
    return sounded
