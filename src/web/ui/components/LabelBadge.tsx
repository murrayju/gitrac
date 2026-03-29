import { useMemo } from 'react';

/**
 * Parse a hex color string to RGB components.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return {
    r: Number.parseInt(match[1] as string, 16),
    g: Number.parseInt(match[2] as string, 16),
    b: Number.parseInt(match[3] as string, 16),
  };
}

export function LabelBadge({
  label,
  color,
  onRemove,
}: {
  label: string;
  color?: string;
  onRemove?: () => void;
}) {
  const styles = useMemo(() => {
    if (!color) {
      return {
        backgroundColor: 'rgb(31 41 55)', // gray-800 fallback
        color: 'rgb(156 163 175)', // gray-400
        borderColor: 'transparent',
      };
    }

    const rgb = hexToRgb(color);
    if (!rgb) {
      return {
        backgroundColor: 'rgb(31 41 55)',
        color: 'rgb(156 163 175)',
        borderColor: 'transparent',
      };
    }

    // Use a semi-transparent version of the color as background
    const bgAlpha = 0.15;
    const borderAlpha = 0.4;

    return {
      backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${bgAlpha})`,
      color,
      borderColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${borderAlpha})`,
    };
  }, [color]);

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border"
      style={styles}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="opacity-60 hover:opacity-100 transition-opacity"
          style={{ color: styles.color }}
        >
          ×
        </button>
      )}
    </span>
  );
}
