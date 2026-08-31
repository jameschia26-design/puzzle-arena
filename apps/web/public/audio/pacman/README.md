# Pac-Man Audio — License Note

All Pac-Man sounds and music in this project are **synthesized at runtime via WebAudio** (square/sawtooth oscillators) in `apps/web/src/ui/sound.tsx`.

No sampled audio from Namco or other Pac-Man recordings is bundled. The `pacman` BGM track and SFX (`pacWaka`, `pacPower`, `pacEatGhost`, `pacDeath`, `pacSiren`) are original 8-bit compositions inspired by the arcade style, synthesized procedurally when played.

Because no external sample files are shipped, there is no third-party audio asset license to propagate. The `apps/web/public/audio/pacman/` directory is intentionally empty (reserved for optional future HTMLAudio fallbacks); if files are added later they MUST be CC0 or equivalently permissively licensed and documented here.

Mute behavior: all playback respects the `pa:sound` / `pa:music` localStorage flags and the WebAudio `sfxGain` / `bgmGain` nodes. Play calls are lazy (context created on first user gesture via `unlockAudioSession`) and respect `prefers-reduced-motion` only where applicable to visuals; audio itself is user-toggled.

Tracks covered: intro (via `bgm.play('pacman')`), siren (`sfx.pacSiren` on tick), waka (`pacWaka` per dot), power (`pacPower` on pellet), ghost eaten (`pacEatGhost`), death (`pacDeath`), intermission (level clear fanfare via `sfx.extraTurn` + BGM loop).
