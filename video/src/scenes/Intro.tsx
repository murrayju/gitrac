import {
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { colors } from '../theme';

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Backdrop>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 34,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            scale: interpolate(frame, [0, 0.9 * fps], [0.92, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              output: 'perceptual-scale',
            }),
          }}
        >
          <Img
            src={staticFile('logo.svg')}
            style={{ width: 132, height: 132 }}
          />
          <div style={{ fontSize: 150, fontWeight: 700, letterSpacing: -4 }}>
            gitrac
          </div>
        </div>
        <div
          style={{
            fontSize: 54,
            color: colors.muted,
            opacity: interpolate(frame, [0.5 * fps, 1.1 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            translate: interpolate(
              frame,
              [0.5 * fps, 1.1 * fps],
              ['0px 16px', '0px 0px'],
              {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              },
            ),
          }}
        >
          Issue tracking that lives in your git repo.
        </div>
      </div>
    </Backdrop>
  );
};
