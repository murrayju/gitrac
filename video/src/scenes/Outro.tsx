import {
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { colors, fonts } from '../theme';

export const Outro: React.FC = () => {
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
          gap: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <Img
            src={staticFile('logo.svg')}
            style={{ width: 100, height: 100 }}
          />
          <div style={{ fontSize: 112, fontWeight: 700, letterSpacing: -3 }}>
            gitrac
          </div>
        </div>
        <div style={{ fontSize: 44, color: colors.muted }}>
          Your issues, in your repo, next to your code.
        </div>
        <div
          style={{
            marginTop: 16,
            padding: '24px 40px',
            borderRadius: 16,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.raised,
            fontFamily: fonts.mono,
            fontSize: 40,
            opacity: interpolate(frame, [0.4 * fps, 1 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            translate: interpolate(
              frame,
              [0.4 * fps, 1 * fps],
              ['0px 16px', '0px 0px'],
              {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              },
            ),
          }}
        >
          <span style={{ color: colors.muted }}>$ </span>
          curl -fsSL https://get.gitrac.dev | bash
        </div>
        <div
          style={{
            fontSize: 46,
            fontWeight: 600,
            color: colors.accent,
            opacity: interpolate(frame, [0.9 * fps, 1.5 * fps], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          gitrac.dev
        </div>
      </div>
    </Backdrop>
  );
};
