"""Happy Birthday, transcribed for Runenote.

The melody of Mildred and Patty Hill's "Good Morning to All" (1893), sung to
the birthday words since the early 1900s; the melody is public domain and no
words are carried here. In C major with a plain accompaniment of our own, one
root-position triad a bar. The accompaniment is CC BY-SA 4.0 with the core
pack.

It earns its place as the song the family will actually play on the day, and
as the first with a dotted-eighth and sixteenth, a rhythm every phrase opens
on and the arranger must keep exactly as written.

The committed ``source.musicxml`` is this module's output; a test keeps the two
equal. To refresh it after a correction, from ``pipeline/``::

    python tests/fixtures/happy_birthday.py > ../content/packs/core/happy-birthday/source.musicxml
    runenote regenerate ../content/packs/core/happy-birthday
"""

from __future__ import annotations

import sys

from fixtures.transcription import Tune, score

TUNE = Tune(
    title="Happy Birthday",
    composer="Mildred J. Hill",
    key="C",
    time="3/4",
    tempo_bpm=96,
    melody="""
    G4:e. G4:s
    | A4 G4 C5 | B4:h G4:e. G4:s | A4 G4 D5 | C5:h G4:e. G4:s
    | G5 E5 C5 | B4 A4 F5:e. F5:s | E5 C5 D5 | C5:h
    """,
    accompaniment="""
    r:q
    | C | G | G | C
    | C | F | C:h G:q | C:h
    """,
    chords={"C": "C3 E3 G3", "F": "F2 A2 C3", "G": "G2 B2 D3"},
)

if __name__ == "__main__":
    from runenote.bundle import musicxml_text

    sys.stdout.write(musicxml_text(score(TUNE)))
