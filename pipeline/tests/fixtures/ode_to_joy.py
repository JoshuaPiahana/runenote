"""Ode to Joy, transcribed for Runenote.

The theme from the finale of Beethoven's Symphony No. 9, Op. 125 (1824), in
its home key of D major, with a plain two-hand piano accompaniment of our
own: root-position triads, two to a bar. The composition is public domain;
the accompaniment is CC BY-SA 4.0 with the rest of the core pack.

The theme earns its place as the first fixture because it is small and still
exercises every rule the arranger has: the dotted figure that closes each
phrase must survive untouched, and the drop to the low dominant in bar 12 puts
the melody an octave wide, so a five-finger tier only exists by folding.

Written as text so a wrong note can be seen and fixed here. The committed
``source.musicxml`` in the core pack is this module's output, and a test keeps
the two equal. To refresh it after a correction, from ``pipeline/``::

    python tests/fixtures/ode_to_joy.py > ../content/packs/core/ode-to-joy/source.musicxml
    runenote regenerate ../content/packs/core/ode-to-joy
"""

from __future__ import annotations

import sys
from fractions import Fraction

from music21 import chord, clef, duration, key, layout, metadata, meter, note, stream, tempo

TITLE = "Ode to Joy"
COMPOSER = "Ludwig van Beethoven"
TEMPO_BPM = 120

# One token per note: pitch, then an optional ":duration". Bars are separated
# by "|" for the reader only. Durations: q quarter (the default), e eighth,
# h half; a trailing "." dots it.
MELODY = """
F#4 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | F#4:q. E4:e E4:h
F#4 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | E4:q. D4:e D4:h
E4 E4 F#4 D4 | E4 F#4:e G4:e F#4 D4 | E4 F#4:e G4:e F#4 E4 | D4 E4 A3:h
F#4 F#4 G4 A4 | A4 G4 F#4 E4 | D4 D4 E4 F#4 | E4:q. D4:e D4:h
"""

# Two half-note chords a bar, named by their root.
ACCOMPANIMENT = """
D D | D A | D D | D A
D D | D A | D D | A D
A D | A D | A A | D A
D D | D A | D D | A D
"""
CHORDS = {"D": "D3 F#3 A3", "A": "A2 C#3 E3"}

_DURATIONS = {"q": Fraction(1), "e": Fraction(1, 2), "h": Fraction(2)}


def _quarter_length(token: str) -> Fraction:
    dotted = token.endswith(".")
    base = _DURATIONS[token.rstrip(".")]
    return base * Fraction(3, 2) if dotted else base


def _melody_part() -> stream.Part:
    part = stream.Part(id="P1")
    part.partName = "Right hand"
    part.append(clef.TrebleClef())
    for token in MELODY.split():
        if token == "|":
            continue
        pitch, _, dur = token.partition(":")
        n = note.Note(pitch)
        n.duration = duration.Duration(_quarter_length(dur or "q"))
        part.append(n)
    return part


def _accompaniment_part() -> stream.Part:
    part = stream.Part(id="P2")
    part.partName = "Left hand"
    part.append(clef.BassClef())
    for token in ACCOMPANIMENT.split():
        if token == "|":
            continue
        c = chord.Chord(CHORDS[token].split())
        c.duration = duration.Duration(_quarter_length("h"))
        part.append(c)
    return part


def score() -> stream.Score:
    """The transcription as a two-part score, bars and all."""
    s = stream.Score()
    s.metadata = metadata.Metadata(title=TITLE, composer=COMPOSER)
    for build in (_melody_part, _accompaniment_part):
        part = build()
        part.insert(0, key.Key("D"))
        part.insert(0, meter.TimeSignature("4/4"))
        part.makeMeasures(inPlace=True)
        s.insert(0, part)
    first_bar = s.parts[0].measure(1)
    assert first_bar is not None
    first_bar.insert(0, tempo.MetronomeMark(number=TEMPO_BPM))
    s.insert(0, layout.StaffGroup(list(s.parts), symbol="brace"))
    return s


if __name__ == "__main__":
    from runenote.bundle import musicxml_text

    sys.stdout.write(musicxml_text(score()))
