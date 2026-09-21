"""The difficulty ladder, read from ``tiers.yaml`` next to this module.

See docs/DECISIONS.md, "Difficulty tiers are our own data table". This module
only gives the table a type; what a level means is the file's business.
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib import resources
from typing import Any, Literal

import yaml

Hands = Literal["right", "both"]
Layer = Literal["melody", "bass", "harmony"]

LAYERS: frozenset[str] = frozenset({"melody", "bass", "harmony"})


@dataclass(frozen=True)
class Tier:
    level: int
    name: str
    hands: Hands
    layers: frozenset[str]
    span: int | None = None
    fold: bool = False
    max_folded: float = 0.0
    max_accidentals: int | None = None

    def __post_init__(self) -> None:
        unknown = self.layers - LAYERS
        if unknown:
            msg = f"tier {self.level}: unknown layers {sorted(unknown)}"
            raise ValueError(msg)
        if "melody" not in self.layers:
            msg = f"tier {self.level}: the player always plays the melody"
            raise ValueError(msg)
        if self.hands == "right" and self.layers != {"melody"}:
            msg = f"tier {self.level}: a right-hand-only tier can only carry the melody"
            raise ValueError(msg)
        if self.fold and self.span is None:
            msg = f"tier {self.level}: folding needs a span to fold into"
            raise ValueError(msg)


def load_tiers() -> list[Tier]:
    text = resources.files(__package__).joinpath("tiers.yaml").read_text(encoding="utf-8")
    return tiers_from(yaml.safe_load(text))


def tiers_from(rows: Any) -> list[Tier]:
    if not isinstance(rows, list) or not rows:
        msg = "the tier table must be a non-empty list"
        raise ValueError(msg)
    tiers = [Tier(**{**row, "layers": frozenset(row["layers"])}) for row in rows]
    levels = [t.level for t in tiers]
    if levels != sorted(levels) or len(set(levels)) != len(levels):
        msg = f"tier levels must be strictly increasing, got {levels}"
        raise ValueError(msg)
    return tiers
