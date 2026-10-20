import { Video } from '@remotion/media';
import {
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Caption } from '../components/Caption';
import { Window } from '../components/Window';
import { colors } from '../theme';

/** A box, in normalized recording coordinates, that appears at `fromSeconds`. */
type Highlight = {
  readonly fromSeconds: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

type TerminalSceneProps = {
  readonly step: number;
  readonly title: string;
  readonly subtitle?: string;
  readonly recording: string;
  /** The size of the recording in pixels. */
  readonly recordingWidth: number;
  readonly recordingHeight: number;
  /** The width of the terminal on screen. */
  readonly contentWidth: number;
  readonly trimStartSeconds: number;
  readonly playbackRate: number;
  readonly highlight?: Highlight;
};

/** A caption above a recording of the person's terminal. */
export const TerminalScene: React.FC<TerminalSceneProps> = ({
  step,
  title,
  subtitle,
  recording,
  recordingWidth,
  recordingHeight,
  contentWidth,
  trimStartSeconds,
  playbackRate,
  highlight,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const contentHeight = (contentWidth * recordingHeight) / recordingWidth;
  const at = (recordingSeconds: number) =>
    ((recordingSeconds - trimStartSeconds) / playbackRate) * fps;
  const top = subtitle ? 215 : 190;
  return (
    <Backdrop>
      <Caption step={step} title={title} subtitle={subtitle} />
      <Window
        title="notes · bash"
        width={contentWidth}
        contentHeight={contentHeight}
        left={(1920 - contentWidth) / 2}
        top={top}
      >
        <Video
          src={staticFile(recording)}
          trimBefore={trimStartSeconds * fps}
          playbackRate={playbackRate}
          muted
          premountFor={fps}
          style={{ width: contentWidth, height: contentHeight }}
        />
        {highlight ? (
          <div
            style={{
              position: 'absolute',
              left: highlight.left * contentWidth,
              top: highlight.top * contentHeight,
              width: (highlight.right - highlight.left) * contentWidth,
              height: (highlight.bottom - highlight.top) * contentHeight,
              borderRadius: 10,
              border: `3px solid ${colors.accent}`,
              backgroundColor: 'rgba(139, 143, 248, 0.10)',
              boxShadow: '0 0 30px rgba(139, 143, 248, 0.35)',
              opacity: interpolate(
                frame,
                [
                  at(highlight.fromSeconds),
                  at(highlight.fromSeconds) + 0.4 * fps,
                ],
                [0, 1],
                {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                  easing: Easing.ease,
                },
              ),
            }}
          />
        ) : null}
      </Window>
    </Backdrop>
  );
};
