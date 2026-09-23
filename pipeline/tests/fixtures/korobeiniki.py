"""Korobeiniki, transcribed for Runenote.

The Russian folk song (a melody set to Nekrasov's 1861 poem), best known as the
theme of Tetris. The tune is public domain; this is its melody alone, the
first strain as it is usually played, with a plain accompaniment of our own
(root-position triads, one to a bar), not any game's arrangement. The
accompaniment is CC BY-SA 4.0 with the core pack.

It earns its place as the song a child already hums: eighth-note runs over a
steady quarter pulse, a dotted figure to hold, and a leap to the high A that
makes the second half an octave wide.

The committed ``source.musicxml`` is this module's output; a test keeps the two
equal. To refresh it after a correction, from ``pipeline/``::

    python tests/fixtures/korobeiniki.py > ../content/packs/core/korobeiniki/source.musicxml
    runenote regenerate ../content/packs/core/korobeiniki
"""

from __future__ import annotations

import sys

from fixtures.transcription import Tune, score

TUNE = Tune(
    title="Korobeiniki",
    composer=None,
    key="a",
    time="4/4",
    tempo_bpm=120,
    melody="""
    E5 B4:e C5:e D5 C5:e B4:e | A4 A4:e C5:e E5 D5:e C5:e | B4:q. C5:e D5 E5 | C5 A4 A4:h
    r:e D5 F5:e A5 G5:e F5:e | E5:q. C5:e E5 D5:e C5:e | B4 B4:e C5:e D5 E5 | C5 A4 A4:h
    """,
    accompaniment="""
    E | Am | E | Am
    Dm | C | E | Am
    """,
    chords={
        "Am": "A2 C3 E3",
        "C": "C3 E3 G3",
        "Dm": "D3 F3 A3",
        "E": "E2 G#2 B2",
    },
)

if __name__ == "__main__":
    from runenote.bundle import musicxml_text

    sys.stdout.write(musicxml_text(score(TUNE)))
