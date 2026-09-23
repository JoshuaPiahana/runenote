"""Twinkle Twinkle Little Star, transcribed for Runenote.

The French folk tune "Ah! vous dirai-je, maman" (published 1761), in C major,
with a plain accompaniment of our own: root-position triads, two to a bar. The
tune is public domain; the accompaniment is CC BY-SA 4.0 with the core pack.

It earns its place as the easiest core song: quarter notes throughout, every
phrase ends on a half note, and the whole tune sits in six notes, C to A, so a
five-finger level needs no folding beyond the one A.

The committed ``source.musicxml`` is this module's output; a test keeps the two
equal. To refresh it after a correction, from ``pipeline/``::

    python tests/fixtures/twinkle_twinkle.py > ../content/packs/core/twinkle-twinkle/source.musicxml
    runenote regenerate ../content/packs/core/twinkle-twinkle
"""

from __future__ import annotations

import sys

from fixtures.transcription import Tune, score

TUNE = Tune(
    title="Twinkle Twinkle Little Star",
    composer=None,
    key="C",
    time="4/4",
    tempo_bpm=100,
    melody="""
    C4 C4 G4 G4 | A4 A4 G4:h | F4 F4 E4 E4 | D4 D4 C4:h
    G4 G4 F4 F4 | E4 E4 D4:h | G4 G4 F4 F4 | E4 E4 D4:h
    C4 C4 G4 G4 | A4 A4 G4:h | F4 F4 E4 E4 | D4 D4 C4:h
    """,
    accompaniment="""
    C:w | F:h C:h | F:h C:h | G:h C:h
    C:h G:h | C:h G:h | C:h G:h | C:h G:h
    C:w | F:h C:h | F:h C:h | G:h C:h
    """,
    chords={"C": "C3 E3 G3", "F": "F2 A2 C3", "G": "G2 B2 D3"},
)

if __name__ == "__main__":
    from runenote.bundle import musicxml_text

    sys.stdout.write(musicxml_text(score(TUNE)))
