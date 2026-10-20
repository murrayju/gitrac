import { AbsoluteFill } from 'remotion';
import { colors, fonts } from '../theme';

/** The dark background with a soft accent glow that every scene uses. */
export const Backdrop: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <AbsoluteFill
    style={{
      backgroundColor: colors.background,
      backgroundImage:
        'radial-gradient(1400px 700px at 50% -15%, rgba(99, 102, 241, 0.22), transparent 70%)',
      color: colors.text,
      fontFamily: fonts.sans,
    }}
  >
    {children}
  </AbsoluteFill>
);
