# PS1 identification data sources

OrbitPS2's RiptOPL PS1 identification work intentionally keeps imported data small and auditable.

- **pcm720 / OSDMenu** — the generic-boot PS1 fallback table in `src/utils/ps1-pvd-game-id.ts` is derived from the factual ISO9660 PVD creation-timestamp → disc-ID mappings in `common/include/game_id_table.h`, pinned to commit `a2b847a2d1b319483fe1fa84d4dc14493b7bbc6f`.
- **GDX-X / PFS-BatchKit-Manager** — `src/data/ps1-disc-conflicts.json` contains the small PS1 shared-serial MD5/title/disc-ID conflict table from `PFS-BatchKit-Manager/BAT/Fix_Conflict_Gameid_Title.bat`, pinned to commit `5e7e835ced587bb4784fe24489e0918ca0d44e2c`.
- **OrbitPS2 integration** — the parser, CUE/VCD handling, safe ambiguity state, storage naming, artwork gating, and regression tests are integration code in this fork rather than copied implementations from those projects.

The full upstream databases are not vendored. Only the factual mappings needed for the implemented resolution paths are retained.
