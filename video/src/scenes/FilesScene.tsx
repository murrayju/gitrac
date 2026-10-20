import { TerminalScene } from './TerminalScene';

/** The CLI shows the same issues, and every change is a commit. */
export const FilesScene: React.FC = () => (
  <TerminalScene
    step={2}
    title="The CLI works with the same issues."
    subtitle="Each one is a markdown file in .issues/, and every change is a commit."
    recording="recordings/files.mp4"
    recordingWidth={2600}
    recordingHeight={1400}
    contentWidth={1460}
    trimStartSeconds={0.8}
    playbackRate={1.2}
  />
);
