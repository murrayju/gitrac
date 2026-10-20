# gitrac promo video

The demo video at the top of [gitrac.dev](https://gitrac.dev) (`www/video/gitrac-demo.mp4`).
It is made with [Remotion](https://www.remotion.dev) from real recordings of the gitrac web UI,
the gitrac CLI and a coding agent ([pi](https://pi.dev)) working in a small demo repository.

```
record/            Playwright script that makes the recordings
  record.mjs       The scenes: author, files, agent, commit
  setup-demo.sh    Creates the demo repository ("notes") with its first issues
  demo-project/    The demo repository's code and AGENTS.md
public/recordings/ The recordings (MP4) and their timing (JSON)
src/               The Remotion composition (Promo) and its scenes
render.sh          Renders the video and exports it to www/
```

## Preview and render

```bash
npm install
npm run dev        # Remotion Studio
npm run render     # writes ../www/video/gitrac-demo.mp4 and ../www/images/demo-poster.jpg
```

If another server already uses port 3000, add `--port=<free port>` (`npm run render -- --port=3456`).

## Record again

You need Google Chrome, `ttyd`, `ffmpeg`, `pi` with a working model login, and a gitrac
binary (`./bun run scripts/build.ts` in the repository root).

```bash
npm run record                 # all scenes, in a fresh demo repository in /tmp/gitrac-video
npm run record -- files        # only some scenes, against the existing demo repository
AGENT_MODEL=openrouter/anthropic/claude-opus-5.5 npm run record
```

The agent's run is different every time. After you record again, check the new recordings
and update the times in `src/scenes/*.tsx`: the trims, playback rates, camera shots and the
highlight box in `CommitScene.tsx`. `public/recordings/agent.json` has the times when the agent
closed each issue.
