import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PROGRESS_MAX, PROGRESS_MIN } from '@/exercise/progress';
import {
  axisLabelFor,
  buildChartGeometry,
  CHART_AXIS_GUTTER,
  CHART_DOT,
  CHART_HEIGHT,
  CHART_STROKE,
  type ChartInputPoint,
} from '@/exercise/progress-chart-geometry';

export { axisLabelFor };
export type { ChartInputPoint };

export type ProgressChartProps = {
  /** Real sessions, oldest first. Every one is drawn; none is merged or dropped. */
  points: readonly ChartInputPoint[];
  /** Date caption for the first session on the axis. */
  startLabel?: string | null;
  /** Date caption for the last session on the axis. */
  endLabel?: string | null;
};

/**
 * A plain-View line chart: no SVG and no chart library, so the app gains no
 * dependency and the chart behaves identically on iOS, Android, and web.
 *
 * All of the interesting decisions - the fixed 0-100 vertical axis, the
 * session-order horizontal axis, one dot per real session - live in
 * `progress-chart-geometry`, where they are covered by tests. This file only
 * draws the result.
 */
export function ProgressChart({ points, startLabel, endLabel }: ProgressChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  // Measured from the plot view itself, whose width is already the space left
  // over after the fixed-width axis gutter.
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    // Only re-render when the width actually moves, so an unrelated re-render
    // does not re-run the layout maths on every pass.
    if (next > 0 && next !== width) setWidth(next);
  };

  const geometry = useMemo(() => buildChartGeometry(points, width), [points, width]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <View style={styles.axis}>
          <Text style={[styles.axisLabel, { color: theme.textSecondary }]}>{PROGRESS_MAX}</Text>
          <Text style={[styles.axisLabel, { color: theme.textSecondary }]}>
            {(PROGRESS_MAX + PROGRESS_MIN) / 2}
          </Text>
          <Text style={[styles.axisLabel, { color: theme.textSecondary }]}>{PROGRESS_MIN}</Text>
        </View>

        <View style={styles.plot} onLayout={onLayout}>
          {/*
            The three gridlines are what make the fixed 0-100 axis legible: they
            let a reader judge a dot's height without trusting position alone.
          */}
          {[0, 0.5, 1].map((ratio) => (
            <View
              key={ratio}
              style={[styles.gridline, { backgroundColor: theme.border, top: `${ratio * 100}%` }]}
            />
          ))}

          {geometry.segments.map((segment, index) => (
            <View
              key={`segment-${index}`}
              style={[
                styles.segment,
                {
                  left: segment.left,
                  top: segment.top,
                  width: segment.width,
                  height: segment.height,
                  backgroundColor: theme.accent,
                  transform: [{ rotate: `${segment.angle}deg` }],
                },
              ]}
            />
          ))}

          {geometry.points.map((point) => (
            <View
              key={point.key}
              style={[
                styles.dot,
                {
                  left: point.x - CHART_DOT / 2,
                  top: point.y - CHART_DOT / 2,
                  width: CHART_DOT,
                  height: CHART_DOT,
                  borderRadius: CHART_DOT / 2,
                  backgroundColor: theme.accent,
                  borderColor: theme.backgroundElement,
                },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.captionRow}>
        <Text style={[styles.caption, { color: theme.textSecondary }]}>{startLabel ?? ''}</Text>
        <Text style={[styles.captionCenter, { color: theme.textSecondary }]}>
          oldest → newest
        </Text>
        <Text style={[styles.caption, { color: theme.textSecondary }]}>{endLabel ?? ''}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  axis: {
    width: CHART_AXIS_GUTTER,
    height: CHART_HEIGHT,
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  axisLabel: {
    ...Type.caption,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  plot: {
    flex: 1,
    height: CHART_HEIGHT,
  },
  gridline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  segment: {
    position: 'absolute',
    borderRadius: CHART_STROKE / 2,
  },
  dot: {
    position: 'absolute',
    borderWidth: 2,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingLeft: CHART_AXIS_GUTTER,
  },
  caption: {
    ...Type.caption,
    fontSize: 12,
  },
  captionCenter: {
    ...Type.caption,
    fontSize: 12,
    flexShrink: 1,
    textAlign: 'center',
  },
});
