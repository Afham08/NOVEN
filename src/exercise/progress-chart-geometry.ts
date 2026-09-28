import { PROGRESS_MAX, PROGRESS_MIN } from './progress';
import { dayLabel } from './session-store';

/**
 * Layout maths for the 30-day progress chart.
 *
 * Deliberately kept as pure arithmetic, away from the React Native component, so
 * the geometry can be checked directly in the test suite. The project's test
 * build covers plain logic under `src/exercise/` and does not mount views, and a
 * line chart is exactly the kind of thing that quietly breaks: a flipped
 * vertical axis or a fitted-to-the-data scale would both still render, and both
 * would quietly lie to the user.
 */

/** Height of the plot area, in points. */
export const CHART_HEIGHT = 150;
/** Thickness of the line joining the sessions. */
export const CHART_STROKE = 3;
/** Diameter of a session dot. */
export const CHART_DOT = 12;
/** Keeps the first and last dot fully inside the plot instead of half cropped. */
export const CHART_EDGE_INSET = CHART_DOT / 2 + 2;
/** Space reserved on the left for the 0 / 50 / 100 axis labels. */
export const CHART_AXIS_GUTTER = 30;

export type ChartInputPoint = {
  key: string;
  score: number;
};

export type ChartPoint = ChartInputPoint & {
  /** Centre of the dot, in plot-area coordinates. */
  x: number;
  y: number;
};

export type ChartSegment = {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
};

export type ChartGeometry = {
  points: ChartPoint[];
  segments: ChartSegment[];
};

/**
 * Turns a series of real scores into pixel positions and line segments.
 *
 * VERTICAL AXIS IS FIXED AT 0-100, NEVER FITTED TO THE DATA
 * Fitting the axis to the visible range would turn a 78-to-84 change into a
 * dramatic climb that the reader would reasonably mistake for a large
 * improvement. Pinning the axis to the score's real 0-100 range means a dot is
 * always at the same height for the same score, so the chart stays honest and
 * two charts from different weeks stay directly comparable. It also matches the
 * 0-100 bar already drawn by the score card above it.
 *
 * HORIZONTAL AXIS IS SESSION ORDER, NOT CALENDAR TIME
 * Sessions are spaced evenly by sequence, oldest on the left. Spacing by real
 * elapsed time was rejected because several sessions on one day would land on
 * top of each other and hide real points, and averaging them together would
 * discard sessions the user really did. The trade-off is that the x-axis is not
 * a ruler of time, so the component labels the first and last session with
 * their real dates and names the ordering in the caption.
 */
export function buildChartGeometry(
  input: readonly ChartInputPoint[],
  width: number,
  height: number = CHART_HEIGHT,
): ChartGeometry {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { points: [], segments: [] };
  }

  const innerWidth = Math.max(0, width - CHART_EDGE_INSET * 2);
  const innerHeight = Math.max(0, height - CHART_EDGE_INSET * 2);
  const count = input.length;
  if (count === 0 || innerWidth <= 0 || innerHeight <= 0) {
    return { points: [], segments: [] };
  }

  const points: ChartPoint[] = input.map((point, index) => {
    // A lone session sits in the middle rather than hard against the left edge,
    // so a single-point chart does not look like a truncated trend.
    const ratioX = count === 1 ? 0.5 : index / (count - 1);
    const ratioY = (point.score - PROGRESS_MIN) / (PROGRESS_MAX - PROGRESS_MIN);
    const clampedRatioY = Math.max(0, Math.min(1, ratioY));
    return {
      key: point.key,
      score: point.score,
      x: CHART_EDGE_INSET + innerWidth * ratioX,
      y: CHART_EDGE_INSET + innerHeight * (1 - clampedRatioY),
    };
  });

  const segments: ChartSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    // Each segment is a short bar rotated about its own centre. Placing the bar
    // by its centre point means the rotation lands exactly on the two dots
    // without depending on transformOrigin support, and keeps the joins closed.
    segments.push({
      left: from.x + dx / 2 - length / 2,
      top: from.y + dy / 2 - CHART_STROKE / 2,
      width: length,
      height: CHART_STROKE,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }

  return { points, segments };
}

/** Axis caption for a stored timestamp, e.g. "Today" / "Yesterday" / "3 Sep". */
export function axisLabelFor(completedAt: string): string | null {
  return dayLabel(completedAt);
}
