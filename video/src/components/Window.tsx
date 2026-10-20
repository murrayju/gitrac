import { colors, fonts } from '../theme';

const TITLE_BAR_HEIGHT = 40;

type WindowProps = {
  readonly title: string;
  readonly width: number;
  readonly contentHeight: number;
  readonly left: number;
  readonly top: number;
  readonly children: React.ReactNode;
  readonly style?: React.CSSProperties;
};

/** A desktop window frame around a recording. */
export const Window: React.FC<WindowProps> = ({
  title,
  width,
  contentHeight,
  left,
  top,
  children,
  style,
}) => (
  <div
    style={{
      position: 'absolute',
      left,
      top,
      width,
      height: contentHeight + TITLE_BAR_HEIGHT,
      borderRadius: 14,
      overflow: 'hidden',
      border: `1px solid ${colors.border}`,
      backgroundColor: colors.terminal,
      boxShadow:
        '0 30px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.02)',
      ...style,
    }}
  >
    <div
      style={{
        height: TITLE_BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        backgroundColor: '#161a31',
        borderBottom: `1px solid ${colors.border}`,
        position: 'relative',
      }}
    >
      {['#ff5f57', '#febc2e', '#28c840'].map((dotColor) => (
        <div
          key={dotColor}
          style={{
            width: 13,
            height: 13,
            borderRadius: '50%',
            backgroundColor: dotColor,
            opacity: 0.85,
            marginRight: 8,
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.sans,
          fontSize: 17,
          color: colors.muted,
        }}
      >
        {title}
      </div>
    </div>
    <div
      style={{
        position: 'relative',
        width,
        height: contentHeight,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  </div>
);
