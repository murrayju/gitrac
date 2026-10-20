import { Video } from '@remotion/media';
import { Series, staticFile, useVideoConfig } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Caption } from '../components/Caption';
import { Window } from '../components/Window';

// The agent's terminal is 1760x1360 and the web UI 2080x1360 (pages at 2x).
// Both recordings started together (see public/recordings/agent.json).
const TERMINAL_WIDTH = 940;
const TERMINAL_HEIGHT = (TERMINAL_WIDTH * 1360) / 1760;
const TERMINAL_LEFT = 80;
const TERMINAL_TOP = 215;
// Show the issue list only: skip the sidebar and the empty space below.
const WEB_CROP = { left: 440, top: 0, width: 1640, height: 700 };
const WEB_WIDTH = 780;
const WEB_SCALE = WEB_WIDTH / WEB_CROP.width;
const WEB_HEIGHT = WEB_CROP.height * WEB_SCALE;
const WEB_TOP = TERMINAL_TOP + (TERMINAL_HEIGHT - WEB_HEIGHT) / 2;

type PanesProps = {
  readonly trimStartSeconds: number;
  readonly playbackRate: number;
};

/** The agent's terminal and the live web UI, at the same point in time. */
const Panes: React.FC<PanesProps> = ({ trimStartSeconds, playbackRate }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Window
        title="agent-1 · pi"
        width={TERMINAL_WIDTH}
        contentHeight={TERMINAL_HEIGHT}
        left={TERMINAL_LEFT}
        top={TERMINAL_TOP}
      >
        <Video
          src={staticFile('recordings/agent-terminal.mp4')}
          trimBefore={trimStartSeconds * fps}
          playbackRate={playbackRate}
          muted
          premountFor={fps}
          style={{ width: TERMINAL_WIDTH, height: TERMINAL_HEIGHT }}
        />
      </Window>
      <Window
        title="gitrac · localhost:3000"
        width={WEB_WIDTH}
        contentHeight={WEB_HEIGHT}
        left={TERMINAL_LEFT + TERMINAL_WIDTH + 40}
        top={WEB_TOP}
      >
        <Video
          src={staticFile('recordings/agent-web.mp4')}
          trimBefore={trimStartSeconds * fps}
          playbackRate={playbackRate}
          muted
          premountFor={fps}
          style={{
            position: 'absolute',
            left: -WEB_CROP.left * WEB_SCALE,
            top: -WEB_CROP.top * WEB_SCALE,
            width: 2080 * WEB_SCALE,
            height: 1360 * WEB_SCALE,
          }}
        />
      </Window>
    </>
  );
};

/** A coding agent works through the backlog while the web UI updates live. */
export const AgentScene: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <Backdrop>
      <Caption
        step={3}
        title="An agent works through them in priority order."
        subtitle="It claims each issue, fixes it, and closes it in the same commit. The web UI updates live."
      />
      <Series>
        <Series.Sequence name="Prompt" durationInFrames={66} premountFor={fps}>
          <Panes trimStartSeconds={3.4} playbackRate={1} />
        </Series.Sequence>
        <Series.Sequence
          name="Work (2.6x)"
          durationInFrames={397}
          premountFor={fps}
        >
          <Panes trimStartSeconds={5.6} playbackRate={2.6} />
        </Series.Sequence>
        <Series.Sequence
          name="Summary"
          durationInFrames={165}
          premountFor={fps}
        >
          <Panes trimStartSeconds={40} playbackRate={1} />
        </Series.Sequence>
      </Series>
    </Backdrop>
  );
};
