"""The rules in docs/DECISIONS.md, "Content packs are the unit of swap".

Each test states a rule and shows the guard enforcing it. If a rule changes,
change the test; if a test fails, the repository is holding something it must
not.
"""

from __future__ import annotations

from conftest import REAL_ROOT, FakeRepo
from runenote.guard import Report, check


def assert_problem(report: Report, text: str) -> None:
    assert any(text in problem for problem in report.problems), report.problems


def test_the_real_repository_passes_its_own_guard() -> None:
    report = check(REAL_ROOT)
    assert report.ok, report.problems


def test_a_clean_core_song_and_a_quest_that_uses_it_pass(repo: FakeRepo) -> None:
    repo.add_song("twinkle")
    repo.add_quest("first-notes", "core/twinkle")
    report = check(repo.root)
    assert report.ok, report.problems
    assert (report.songs_checked, report.quests_checked) == (1, 1)


def test_core_rejects_a_source_without_an_open_licence(repo: FakeRepo) -> None:
    repo.add_song("zeldas-lullaby", licence="fan-arrangement")
    report = check(repo.root)
    assert_problem(report, "licence 'fan-arrangement' is not open")


def test_core_rejects_a_song_that_fails_the_schema(repo: FakeRepo) -> None:
    repo.add_song("broken", tiers=[])
    report = check(repo.root)
    assert_problem(report, "broken: tiers")


def test_core_rejects_a_bundle_whose_files_are_missing(repo: FakeRepo) -> None:
    repo.add_song("hollow", write_files=False)
    report = check(repo.root)
    assert_problem(report, "hollow: referenced file 'tier-1.musicxml' is missing")
    assert_problem(report, "hollow: referenced file 'backing.mid' is missing")


def test_manifest_and_directories_must_agree(repo: FakeRepo) -> None:
    repo.add_song("orphan", listed=False)
    repo.write_pack(["orphan", "ghost"])
    report = check(repo.root)
    assert_problem(report, "'ghost' but no such directory")
    repo.write_pack([])
    report = check(repo.root)
    assert_problem(report, "'orphan' is not listed")


def test_quests_may_only_reference_the_core_pack(repo: FakeRepo) -> None:
    repo.add_song("twinkle")
    repo.add_quest("forest", "family/zeldas-lullaby")
    report = check(repo.root)
    assert_problem(report, "may only use the 'core' pack")


def test_quests_may_only_reference_songs_that_exist(repo: FakeRepo) -> None:
    repo.add_quest("forest", "core/nowhere")
    report = check(repo.root)
    assert_problem(report, "'core/nowhere', which is not in core")
