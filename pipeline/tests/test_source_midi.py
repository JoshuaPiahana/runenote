"""MIDI and MusicXML are two doors into the same model.

The rule: a MIDI export of a score arranges to the same notes, in the same
rhythm and key, as the score itself. Game piano arrangements mostly arrive as
MIDI, so if this drifts, every family-pack song drifts with it.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from fixtures import ode_to_joy
from runenote.arrange import arrange
from runenote.source import Source, SourceError, load
from runenote.tiers import load_tiers

MELODY = 1


def notes_of(source: Source) -> dict[int, list[tuple[float, float, tuple[int, ...]]]]:
    """Every tier's notes, as (offset, length, pitches), by level."""
    tiers = arrange(source, MELODY, load_tiers()).tiers
    return {
        t.tier.level: [
            (float(n.offset), float(n.quarterLength), tuple(p.midi for p in n.pitches))
            for part in t.score.parts
            for n in part.flatten().notes
        ]
        for t in tiers
    }


@pytest.fixture(scope="module")
def as_midi(tmp_path_factory: pytest.TempPathFactory) -> Source:
    path = tmp_path_factory.mktemp("midi") / "ode.mid"
    ode_to_joy.score().write("midi", fp=str(path))
    return load(path)


def test_midi_arranges_like_the_score_it_came_from(ode: Source, as_midi: Source) -> None:
    assert (str(as_midi.key), as_midi.time_signature) == (str(ode.key), ode.time_signature)
    assert as_midi.suggested_melody() == MELODY
    assert notes_of(as_midi) == notes_of(ode)


def test_midi_is_recorded_as_midi(ode: Source, as_midi: Source) -> None:
    assert (as_midi.kind, ode.kind) == ("midi", "musicxml")


def test_an_untitled_midi_is_named_after_its_file(as_midi: Source) -> None:
    assert as_midi.title == "ode"


def test_other_formats_are_refused(tmp_path: Path) -> None:
    pdf = tmp_path / "lullaby.pdf"
    pdf.write_bytes(b"%PDF")
    with pytest.raises(SourceError, match="not a MusicXML or MIDI file"):
        load(pdf)
