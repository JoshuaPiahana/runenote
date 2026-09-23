"""Amazing Grace, transcribed for Runenote.

John Newton's hymn (1779) to the American tune "New Britain" (1829), in G
major, with a plain accompaniment of our own: one root-position triad a bar.
The tune is public domain; the accompaniment is CC BY-SA 4.0 with the core
pack.

It earns its place as the first core song in 3/4, and the first to open on a
pickup, so the count-in has to land on beat three. The long "me" in the middle
is tied across a bar, which a player must hold rather than restrike.

The committed ``source.musicxml`` is this module's output; a test keeps the two
equal. To refresh it after a correction, from ``pipeline/``::

    python tests/fixtures/amazing_grace.py > ../content/packs/core/amazing-grace/source.musicxml
    runenote regenerate ../content/packs/core/amazing-grace
"""

from __future__ import annotations

import sys

from fixtures.transcription import Tune, score

TUNE = Tune(
    title="Amazing Grace",
    composer=None,
    key="G",
    time="3/4",
    tempo_bpm=84,
    melody="""
    D4
    | G4:h B4:e G4:e | B4:h A4 | G4:h E4 | D4:h D4
    | G4:h B4:e G4:e | B4:h A4 | D5:h.~ | D5:h B4
    | D5:h B4:e G4:e | B4:h A4 | G4:h E4 | D4:h D4
    | G4:h B4:e G4:e | B4:h A4 | G4:h
    """,
    accompaniment="""
    r:q
    | G | G | C | G
    | G | Em | D | D
    | G | G | C | G
    | G | D | G:h
    """,
    chords={
        "C": "C3 E3 G3",
        "D": "D3 F#3 A3",
        "Em": "E3 G3 B3",
        "G": "G2 B2 D3",
    },
)

if __name__ == "__main__":
    from runenote.bundle import musicxml_text

    sys.stdout.write(musicxml_text(score(TUNE)))
