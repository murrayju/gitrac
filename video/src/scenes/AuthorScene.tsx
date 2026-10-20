import { Video } from '@remotion/media';
import { staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Caption } from '../components/Caption';
import { cameraStyle } from '../components/camera';
import { Window } from '../components/Window';

// The recording is 2240x1320 (a 1120x660 page at 2x).
const CONTENT_WIDTH = 1400;
const CONTENT_HEIGHT = (CONTENT_WIDTH * 1320) / 2240;
const TRIM_START_SECONDS = 0.6;
const PLAYBACK_RATE = 1.4;

/** A person writes a new issue and reprioritizes another one in the web UI. */
export const AuthorScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Convert a time in the recording to a frame in this scene.
  const at = (recordingSeconds: number) =>
    ((recordingSeconds - TRIM_START_SECONDS) / PLAYBACK_RATE) * fps;
  return (
    <Backdrop>
      <Caption
        step={1}
        title="You write and prioritize issues in the web UI."
      />
      <Window
        title="gitrac · localhost:3000"
        width={CONTENT_WIDTH}
        contentHeight={CONTENT_HEIGHT}
        left={260}
        top={180}
      >
        <div
          style={{
            width: CONTENT_WIDTH,
            height: CONTENT_HEIGHT,
            ...cameraStyle(
              frame,
              [
                { frame: at(1.6), scale: 1, x: 0.5, y: 0.5 },
                { frame: at(2.4), scale: 1.5, x: 0.5, y: 0.3 },
                { frame: at(13.3), scale: 1.5, x: 0.5, y: 0.3 },
                { frame: at(14.1), scale: 1, x: 0.5, y: 0.5 },
                { frame: at(17.9), scale: 1, x: 0.5, y: 0.5 },
                { frame: at(18.7), scale: 1.25, x: 0.7, y: 0.3 },
                { frame: at(22.0), scale: 1.25, x: 0.7, y: 0.3 },
                { frame: at(22.8), scale: 1, x: 0.5, y: 0.5 },
                { frame: at(24.0), scale: 1, x: 0.5, y: 0.5 },
                { frame: at(24.8), scale: 1.25, x: 0.6, y: 0.2 },
              ],
              CONTENT_WIDTH,
              CONTENT_HEIGHT,
            ),
          }}
        >
          <Video
            src={staticFile('recordings/author.mp4')}
            trimBefore={TRIM_START_SECONDS * fps}
            playbackRate={PLAYBACK_RATE}
            muted
            premountFor={fps}
            style={{ width: CONTENT_WIDTH, height: CONTENT_HEIGHT }}
          />
        </div>
      </Window>
    </Backdrop>
  );
};
