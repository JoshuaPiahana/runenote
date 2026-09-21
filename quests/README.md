# Quests

One YAML file per quest, validated against `content/schema/quest.schema.json`.

A quest teaches one new thing and follows the unit skeleton: `learn` it,
`prepare` on the capstone song's own hard bars, play the `song`, `revisit`
material from earlier quests, `practice` freely.

Quests ship with the app, so they may only reference songs in the `core`
pack. `./rune guard` (and CI) rejects anything else. Family packs are for
Free Play and Survival, not for quests.
