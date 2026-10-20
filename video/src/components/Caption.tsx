import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { colors } from '../theme';

type CaptionProps = {
  readonly step: number;
  readonly title: string;
  readonly subtitle?: string;
};

/** The numbered headline at the top of a scene. */
export const Caption: React.FC<CaptionProps> = ({ step, title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 52,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        opacity: interpolate(frame, [0.15 * fps, 0.6 * fps], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        }),
        translate: interpolate(
          frame,
          [0.15 * fps, 0.6 * fps],
          ['0px 14px', '0px 0px'],
          {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          },
        ),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            fontWeight: 700,
            color: 'white',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          }}
        >
          {step}
        </div>
        <div style={{ fontSize: 50, fontWeight: 600, letterSpacing: -0.5 }}>
          {title}
        </div>
      </div>
      {subtitle ? (
        <div style={{ fontSize: 28, color: colors.muted, fontWeight: 400 }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
};
