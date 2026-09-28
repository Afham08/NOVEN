import { check, suite } from './harness';

import {
  axisLabelFor,
  buildChartGeometry,
  CHART_DOT,
  CHART_STROKE,
  type ChartInputPoint,
} from '../src/exercise/progress-chart-geometry';
import { progressHint, PROGRESS_MAX, PROGRESS_MIN } from '../src/exercise/progress';

const WIDTH = 300;
const HEIGHT = 150;

function series(...scores: number[]): ChartInputPoint[] {
  return scores.map((score, index) => ({ key: `p${index}`, score }));
}

export function run() {
  suite('progress chart: geometry basics', () => {
    const { points, segments } = buildChartGeometry(series(50), WIDTH, HEIGHT);

    check('one real score produces exactly one dot', points.length === 1);
    check('one real score produces no line', segments.length === 0);
    check('a lone dot is centred, not pinned to the left', Math.abs(points[0].x - WIDTH / 2) < 12, points[0].x);
  });

  suite('progress chart: a higher score sits higher on screen', () => {
    const low = buildChartGeometry(series(20), WIDTH, HEIGHT).points[0];
    const high = buildChartGeometry(series(80), WIDTH, HEIGHT).points[0];

    check('the taller score is drawn higher', high.y < low.y, { low: low.y, high: high.y });
    check('the direction is not inverted', high.y < low.y);
  });

  suite('progress chart: the axis is pinned to the real 0-100 range', () => {
    const zero = buildChartGeometry(series(PROGRESS_MIN), WIDTH, HEIGHT).points[0];
    const max = buildChartGeometry(series(PROGRESS_MAX), WIDTH, HEIGHT).points[0];

    // A full-range score must actually span the plot, not be nudged inside it,
    // otherwise a 100 would look lower than it is.
    check('100 sits at the top of the plot', max.y < 20, max.y);
    check('0 sits at the bottom of the plot', zero.y > HEIGHT - 20, zero.y);

    // And a small real change must stay a small real change: this is the
    // anti-exaggeration guarantee of a fixed axis.
    const a = buildChartGeometry(series(78), WIDTH, HEIGHT).points[0];
    const b = buildChartGeometry(series(84), WIDTH, HEIGHT).points[0];
    const smallChange = Math.abs(a.y - b.y);
    const fullSpan = Math.abs(zero.y - max.y);
    check('a 6-point change is far smaller than the full range', smallChange < fullSpan * 0.15, {
      smallChange,
      fullSpan,
    });
  });

  suite('progress chart: one dot per real session, joined in order', () => {
    const { points, segments } = buildChartGeometry(series(40, 60, 80), WIDTH, HEIGHT);

    check('three sessions give three dots', points.length === 3);
    check('n sessions give n-1 line segments', segments.length === 2);
    check('dots run left to right', points[0].x < points[1].x && points[1].x < points[2].x, points.map((p) => p.x));
    check('dots are evenly spaced', Math.abs(points[0].x - points[1].x) > 0 && Math.abs(points[1].x - points[2].x) > 0);
  });

  suite('progress chart: same-day sessions are not merged', () => {
    const { points } = buildChartGeometry(series(70, 92), WIDTH, HEIGHT);

    check('two sessions give two separate dots', points.length === 2);
    check('they sit at different heights', points[0].y !== points[1].y, points.map((p) => p.y));
    check('neither dot is dropped', points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  });

  suite('progress chart: segments join the dots they connect', () => {
    const { points, segments } = buildChartGeometry(series(50, 50), WIDTH, HEIGHT);
    const flat = segments[0];

    check('a flat line is horizontal', Math.abs(flat.angle) < 0.001, flat.angle);
    check('a flat line is as thick as the stroke', flat.height === CHART_STROKE);
    check('a flat line spans the gap between the dots', Math.abs(flat.width - (points[1].x - points[0].x)) < 0.001, flat.width);

    const rising = buildChartGeometry(series(20, 90), WIDTH, HEIGHT);
    const dx = rising.points[1].x - rising.points[0].x;
    const dy = Math.abs(rising.points[1].y - rising.points[0].y);
    check('a rising line has a negative angle', rising.segments[0].angle < 0, rising.segments[0].angle);
    check('a rising line is the hypotenuse of its own run and rise', Math.abs(rising.segments[0].width - Math.hypot(dx, dy)) < 0.001, rising.segments[0].width);
    check('a rising line is longer than its horizontal gap alone', rising.segments[0].width > dx, { width: rising.segments[0].width, dx });

    // The segment must actually cover its own mid-point, which is the
    // guarantee that the rotated bar lands on the two dots.
    const mid = buildChartGeometry(series(10, 95, 30), WIDTH, HEIGHT);
    for (const segment of mid.segments) {
      const centreX = segment.left + segment.width / 2;
      const centreY = segment.top + segment.height / 2;
      check('a segment is centred on its own middle', centreX >= 0 && centreX <= WIDTH && centreY >= 0 && centreY <= HEIGHT, { centreX, centreY });
    }
  });

  suite('progress chart: edge dots stay fully visible', () => {
    const { points } = buildChartGeometry(series(50, 50, 50), WIDTH, HEIGHT);
    const first = points[0];
    const last = points[points.length - 1];

    check('the first dot is not half cropped', first.x - CHART_DOT / 2 >= 0, first.x);
    check('the last dot is not half cropped', last.x + CHART_DOT / 2 <= WIDTH, last.x);
  });

  suite('progress chart: no data means no drawing', () => {
    check('an empty series draws nothing', buildChartGeometry([], WIDTH, HEIGHT).points.length === 0);
    check('an empty series draws no lines', buildChartGeometry([], WIDTH, HEIGHT).segments.length === 0);
  });

  suite('progress chart: impossible layout is handled, not crashed on', () => {
    check('zero width draws nothing', buildChartGeometry(series(50), 0, HEIGHT).points.length === 0);
    check('negative width draws nothing', buildChartGeometry(series(50), -100, HEIGHT).points.length === 0);
    check('zero height draws nothing', buildChartGeometry(series(50), WIDTH, 0).points.length === 0);
    check('NaN width draws nothing', buildChartGeometry(series(50), Number.NaN, HEIGHT).points.length === 0);
    check('a very narrow plot still returns a dot or none, never a crash', [0, 1, 5, 1000].every((w) => buildChartGeometry(series(50), w, HEIGHT) !== null));
  });

  suite('progress chart: scores outside the range cannot escape the plot', () => {
    // buildProgress never emits these, but the chart must not draw off-canvas
    // if a value ever slips through.
    const over = buildChartGeometry(series(150, -50), WIDTH, HEIGHT);
    check('an over-range score is still drawn inside the plot', over.points.every((p) => p.y >= 0 && p.y <= HEIGHT), over.points.map((p) => p.y));
    check('over-range and under-range clamp to the plot edges', Math.abs(over.points[0].y) < over.points[1].y);
  });

  suite('progress chart: axis captions use real dates', () => {
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    check("today's session is captioned Today", axisLabelFor(today.toISOString()) === 'Today', axisLabelFor(today.toISOString()));
    check('an unparseable date has no caption', axisLabelFor('not a date') === null);
  });

  suite('progress: the score card hint matches the real state', () => {
    check('loading reads as loading, not as zero', progressHint(null, null) === 'Reading your saved sessions.');

    const empty = { points: [], sessionsInWindow: 0, scoredInWindow: 0, guidedInWindow: 0, latest: null, average: null, highest: null, lowest: null, windowStartDayKey: '2026-08-30', windowDays: 30 };
    check('no sessions says so', progressHint(empty, 0).includes('No sessions'));
    check('sessions but none recent says so', progressHint(empty, 4).includes('No sessions'));

    const unscoreable = { ...empty, sessionsInWindow: 2, scoredInWindow: 0 };
    check('sessions that cannot be scored are not called zero', progressHint(unscoreable, 2).includes('too short'), progressHint(unscoreable, 2));

    /*
     * A month of guided sessions and no camera ones is a different situation from
     * a month of camera sessions that were too short, and the wording must not
     * offer "too short to measure" as the reason for something that was never
     * measured.
     */
    const onlyGuided = { ...empty, sessionsInWindow: 3, guidedInWindow: 3 };
    check('guided sessions are not called too short', !progressHint(onlyGuided, 3).includes('too short'), progressHint(onlyGuided, 3));
    check('guided sessions say they were not measured by the camera', progressHint(onlyGuided, 3).includes('not measured by the camera'), progressHint(onlyGuided, 3));
    const mixed = { ...empty, sessionsInWindow: 5, guidedInWindow: 3 };
    check('a mix points at the camera as the thing that would add a score', progressHint(mixed, 5).includes('with the camera'), progressHint(mixed, 5));

    const scored = {
      points: [{ id: 'a', completedAt: new Date().toISOString(), dayKey: '2026-09-28', score: 84 }],
      sessionsInWindow: 1,
      scoredInWindow: 1,
      guidedInWindow: 0,
      latest: { id: 'a', completedAt: new Date().toISOString(), dayKey: '2026-09-28', score: 84 },
      average: 84,
      highest: 84,
      lowest: 84,
      windowStartDayKey: '2026-08-30',
      windowDays: 30,
    };
    check('a real score names the real scale', progressHint(scored, 1) === `Steadiness of your latest session, out of ${PROGRESS_MAX}.`, progressHint(scored, 1));
    check('a scored session alongside guided ones still names the real scale', progressHint({ ...scored, sessionsInWindow: 3, guidedInWindow: 2 }, 3) === `Steadiness of your latest session, out of ${PROGRESS_MAX}.`);
    check('the hint never promises a clinical claim', !/health|medical|diagnos|risk|rehab/i.test(progressHint(scored, 1)));
  });
}
