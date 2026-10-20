import { Easing, interpolate } from 'remotion';

/** A camera position: zoom `scale`, looking at the normalized point (x, y). */
export type Shot = {
  readonly frame: number;
  readonly scale: number;
  readonly x: number;
  readonly y: number;
};

/**
 * Return `scale` and `translate` styles that move a camera between shots.
 * The view never leaves the content, so no empty edges show.
 */
export function cameraStyle(
  frame: number,
  shots: readonly Shot[],
  width: number,
  height: number,
): React.CSSProperties {
  const frames = shots.map((shot) => shot.frame);
  const options = {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.2, 1),
  } as const;
  const scale = interpolate(
    frame,
    frames,
    shots.map((shot) => shot.scale),
    options,
  );
  const x = interpolate(
    frame,
    frames,
    shots.map((shot) => shot.x),
    options,
  );
  const y = interpolate(
    frame,
    frames,
    shots.map((shot) => shot.y),
    options,
  );
  const limitX = ((scale - 1) * width) / 2;
  const limitY = ((scale - 1) * height) / 2;
  const translateX = Math.max(
    -limitX,
    Math.min(limitX, (0.5 - x) * width * scale),
  );
  const translateY = Math.max(
    -limitY,
    Math.min(limitY, (0.5 - y) * height * scale),
  );
  return { scale, translate: `${translateX}px ${translateY}px` };
}
