"""The rules in docs/DECISIONS.md, "Simplify by removing layers, never by
rewriting the melody's rhythm", shown on Ode to Joy.

Each test states a rule. If the tier table is re-tuned the numbers here may
move; if a rule breaks, the arranger is teaching the wrong tune.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from music21 import chord, key, meter, stream

from conftest import melody_only, source_from
from runenote.arrange import ArrangedTier, ArrangeError, Backing, arrange, fold_plan, nearest_key
from runenote.source import Source
from runenote.tiers import load_tiers

MELODY = 1
TIERS = load_tiers()


def durations(part: stream.Part) -> list[float]:
    return [float(n.duration.quarterLength) for n in part.flatten().notes]


def names(part: stream.Part, bar: int | None = None) -> list[str]:
    """Pitch names of a part, or of one of its bars; chords joined with '+'."""
    if bar is None:
        played = part.flatten().notes
    else:
        measure = part.measure(bar)
        assert measure is not None, f"no bar {bar}"
        played = measure.notes
    return ["+".join(p.nameWithOctave for p in n.pitches) for n in played]


def by_level(tiers: list[ArrangedTier]) -> dict[int, ArrangedTier]:
    return {t.tier.level: t for t in tiers}


@pytest.fixture(scope="module")
def arranged(ode: Source) -> dict[int, ArrangedTier]:
    return by_level(arrange(ode, MELODY, TIERS).tiers)


def test_the_source_is_read_as_written(ode: Source) -> None:
    assert (ode.title, ode.composer) == ("Ode to Joy", "Ludwig van Beethoven")
    assert (str(ode.key), ode.time_signature, ode.tempo_bpm) == ("D major", "4/4", 120.0)
    assert [(p.index, p.name, p.low, p.high) for p in ode.parts] == [
        (1, "Right hand", 57, 69),
        (2, "Left hand", 45, 57),
    ]
    assert ode.suggested_melody() == MELODY


def test_every_level_exists_for_ode_to_joy(arranged: dict[int, ArrangedTier]) -> None:
    assert sorted(arranged) == [1, 2, 3, 4]


def test_the_melody_rhythm_is_never_changed(ode: Source, arranged: dict[int, ArrangedTier]) -> None:
    written = durations(ode.part(MELODY))
    for level, tier in arranged.items():
        assert durations(tier.score.parts[0]) == written, f"tier {level} changed the rhythm"


def test_one_key_for_every_level_chosen_for_the_easiest(ode: Source) -> None:
    arrangement = arrange(ode, MELODY, TIERS)
    assert (str(arrangement.key), arrangement.semitones) == ("C major", -2)
    for tier in arrangement.tiers:
        for part in tier.score.parts:
            signatures = part.flatten().getElementsByClass(key.KeySignature)
            assert [k.sharps for k in signatures] == [0], f"tier {tier.tier.level}"
    # The band moves with everything else: its first chord is C major, not D.
    assert isinstance(arrangement.backing, Backing)
    keys = arrangement.backing.score.getElementById("keys")
    assert isinstance(keys, stream.Part)
    opening = [n for n in keys.flatten().notes if float(n.offset) == 1.0]
    assert sorted(p.midi for n in opening for p in n.pitches) == [48, 52, 55]


def test_the_five_finger_level_exists_by_folding_the_one_stray_note(
    arranged: dict[int, ArrangedTier],
) -> None:
    tier = arranged[1]
    assert (tier.low, tier.high, tier.folded) == (60, 67, 1)
    assert names(tier.score.parts[0], bar=12) == ["C4", "D4", "G4"]


def test_the_hand_shift_level_keeps_the_melody_where_it_was(
    arranged: dict[int, ArrangedTier],
) -> None:
    tier = arranged[2]
    assert (tier.low, tier.high, tier.folded) == (55, 67, 0)
    assert names(tier.score.parts[0], bar=12) == ["C4", "D4", "G3"]


def test_the_bass_level_keeps_only_the_lowest_note_of_each_chord(
    arranged: dict[int, ArrangedTier],
) -> None:
    left = arranged[3].score.parts[1]
    played = list(left.flatten().notes)
    assert all(len(n.pitches) == 1 for n in played)
    assert {n.pitches[0].nameWithOctave for n in played} == {"C3", "G2"}
    assert len(played) == 32


def test_the_as_written_level_keeps_the_chords(arranged: dict[int, ArrangedTier]) -> None:
    left = arranged[4].score.parts[1]
    assert {len(n.pitches) for n in left.flatten().notes} == {3}


def test_difficulty_rises_with_each_level(arranged: dict[int, ArrangedTier]) -> None:
    scores = [arranged[level].difficulty for level in sorted(arranged)]
    assert scores == sorted(scores) and len(set(scores)) == len(scores)


def test_a_level_the_melody_cannot_meet_is_simply_absent(tmp_path: Path) -> None:
    # An octave scale: too wide for five fingers without folding most of it,
    # and with no accompaniment there is nothing for a second hand to play.
    scale = source_from(melody_only("C4 D4 E4 F4 G4 A4 B4 C5"), tmp_path / "scale.musicxml")
    arrangement = arrange(scale, MELODY, TIERS)
    assert [t.tier.level for t in arrangement.tiers] == [2]
    assert arrangement.backing is None


def test_a_melody_that_meets_no_level_is_an_error(tmp_path: Path) -> None:
    wide = source_from(melody_only("C3 C4 C5 C6 C3 C4 C5 C6"), tmp_path / "wide.musicxml")
    with pytest.raises(ArrangeError, match="meets no tier"):
        arrange(wide, MELODY, TIERS)


def test_the_melody_layer_is_the_top_of_any_chord_in_the_melody_part(tmp_path: Path) -> None:
    part = stream.Part()
    part.insert(0, key.Key("C"))
    part.insert(0, meter.TimeSignature("4/4"))
    part.append(chord.Chord("C4 E4 G4", quarterLength=2))
    part.append(chord.Chord("D4 F4 A4", quarterLength=2))
    part.makeMeasures(inPlace=True)
    score = stream.Score()
    score.insert(0, part)
    thick = source_from(score, tmp_path / "thick.musicxml")
    tier = arrange(thick, MELODY, TIERS).tiers[0]
    assert names(tier.score.parts[0]) == ["G4", "A4"]


def test_a_source_without_a_tempo_gets_a_declared_guess(tmp_path: Path) -> None:
    silent = source_from(melody_only("C4 D4 E4 F4"), tmp_path / "silent.musicxml")
    assert (silent.tempo_bpm, silent.tempo_is_default) == (120.0, True)
    told = source_from(melody_only("C4 D4 E4 F4"), tmp_path / "told.musicxml", tempo_bpm=90)
    assert (told.tempo_bpm, told.tempo_is_default) == (90.0, False)


@pytest.mark.parametrize(
    ("written", "max_accidentals", "expected", "semitones"),
    [
        ("D", 0, "C major", -2),  # Ode to Joy: two sharps down to none
        ("D", 2, "D major", 0),  # already within reach: untouched
        ("E-", 1, "F major", 2),  # three flats: F is closer than C
        ("F#", 0, "C major", -6),  # a tritone either way: ties go down
        ("d", 0, "a minor", -5),  # minor keys stay minor
    ],
)
def test_the_nearest_friendlier_key_wins(
    written: str, max_accidentals: int, expected: str, semitones: int
) -> None:
    target, shift = nearest_key(key.Key(written), max_accidentals)
    assert (str(target), shift) == (expected, semitones)


def test_folding_picks_the_window_that_moves_the_fewest_notes() -> None:
    plan = fold_plan([55, 60, 62, 64, 65, 67, 60], span=7)
    assert (plan.low, plan.high, plan.folded) == (60, 67, 1)
