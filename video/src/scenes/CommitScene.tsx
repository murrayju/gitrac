import { TerminalScene } from './TerminalScene';

/** The fix and the closed issue land in the same commit. */
export const CommitScene: React.FC = () => (
  <TerminalScene
    step={4}
    title="The fix and the closed issue land in one commit."
    subtitle="Review the code and the issue in the same diff."
    recording="recordings/commit.mp4"
    recordingWidth={2000}
    recordingHeight={1120}
    contentWidth={1400}
    trimStartSeconds={0.8}
    playbackRate={1}
    highlight={{
      fromSeconds: 6.5,
      left: 0.008,
      top: 0.565,
      right: 0.825,
      bottom: 0.742,
    }}
  />
);
