"""Minuet in G, transcribed for Runenote.

The minuet in G major from the 1725 Notebook for Anna Magdalena Bach (BWV Anh.
114), now credited to Christian Petzold. The right hand is the original melody,
both strains; the left hand is not the original bass line but a plain
accompaniment of our own, one triad a bar, so every core song reads the same
way to the arranger. The composition is public domain; the accompaniment is CC
BY-SA 4.0 with the core pack.

It earns its place as the first real piece a piano student meets: running
eighths against quarters, and a second strain that climbs to B5 and turns to D
major, so the melody spans more than an octave and a half and the easiest
levels will not exist for it. That is the rule working, not a gap.

The committed ``source.musicxml`` is this module's output; a test keeps the two
equal. To refresh it after a correction, from ``pipeline/``::

    python tests/fixtures/minuet_in_g.py > ../content/packs/core/minuet-in-g/source.musicxml
    runenote regenerate ../content/packs/core/minuet-in-g
"""

from __future__ import annotations

import sys

from fixtures.transcription import Tune, score

TUNE = Tune(
    title="Minuet in G",
    composer="Christian Petzold",
    key="G",
    time="3/4",
    tempo_bpm=112,
    melody="""
    D5 G4:e A4:e B4:e C5:e | D5 G4 G4 | E5 C5:e D5:e E5:e F#5:e | G5 G4 G4
    | C5 D5:e C5:e B4:e A4:e | B4 C5:e B4:e A4:e G4:e | F#4 G4:e A4:e B4:e G4:e | A4:h.
    | D5 G4:e A4:e B4:e C5:e | D5 G4 G4 | E5 C5:e D5:e E5:e F#5:e | G5 G4 G4
    | C5 D5:e C5:e B4:e A4:e | B4 C5:e B4:e A4:e G4:e | A4 B4:e A4:e G4:e F#4:e | G4:h.
    | B5 G5:e A5:e B5:e G5:e | A5 D5:e E5:e F#5:e D5:e | G5 E5:e F#5:e G5:e D5:e | C#5 B4:e C#5:e A4
    | A4:e B4:e C#5:e D5:e E5:e F#5:e | G5 F#5 E5 | F#5 A4 C#5 | D5:h.
    | D5 G4:e F#4:e G4 | E5 G4:e F#4:e G4 | D5 C5 B4 | A4:e G4:e F#4:e G4:e A4
    | D4:e E4:e F#4:e G4:e A4:e B4:e | C5 B4 A4 | B4:e D5:e G4 F#4 | G4:h.
    """,
    accompaniment="""
    G | G | C | G
    | Am | G | D | D
    | G | G | C | G
    | Am | G | D | G
    | G | D | Em | A
    | A | Em | A | D
    | G | C | G | D
    | D | Am | G:q D:h | G
    """,
    chords={
        "A": "A2 C#3 E3",
        "Am": "A2 C3 E3",
        "C": "C3 E3 G3",
        "D": "D3 F#3 A3",
        "Em": "E3 G3 B3",
        "G": "G2 B2 D3",
    },
)

if __name__ == "__main__":
    from runenote.bundle import musicxml_text

    sys.stdout.write(musicxml_text(score(TUNE)))
