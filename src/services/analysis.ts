import type { Exercise } from '@/data/exercises';

export type SessionMetricKind = 'accuracy' | 'pace' | 'symmetry' | 'safety';

export type SessionMetric = {
  kind: SessionMetricKind;
  label: string;
  /** 0–100 scale. For safety, lower is better. */
  value: number;
  note: string;
};

export type SessionResult = {
  exerciseId: string;
  exerciseName: string;
  /** Overall 0–100 score. */
  score: number;
  /** One short patient-facing takeaway, e.g. "Good movement". */
  summary: string;
  /** Always `demo-result` until a real movement engine is wired in. */
  status: 'demo-result';
  metrics: SessionMetric[];
  feedback: string[];
};

/**
 * MOCK ANALYSIS — demo data only.
 *
 * Replace this whole module with real MediaPipe / movement-engine output later.
 * Nothing here comes from a camera or pose estimation; the values are fixed.
 */
export const MOCK_ANALYSIS_DELAY_MS = 1500;

const MOCK_METRICS: SessionMetric[] = [
  {
    kind: 'accuracy',
    label: 'Angle Accuracy',
    value: 88,
    note: 'Simulated value — no angle tracking ran.',
  },
  {
    kind: 'pace',
    label: 'Pace',
    value: 82,
    note: 'Simulated value — no movement tracking ran.',
  },
  {
    kind: 'symmetry',
    label: 'Symmetry',
    value: 90,
    note: 'Simulated value — no side-by-side analysis ran.',
  },
  {
    kind: 'safety',
    label: 'Safety Penalty',
    value: 4,
    note: 'Simulated — no real movement was analysed.',
  },
];

const MOCK_OVERALL_SCORE = 86;
const MOCK_SUMMARY = 'Good movement';

/**
 * Patient-facing names and quality words.
 *
 * The technical metrics stay in `SessionResult.metrics` untouched (the future
 * movement engine uses them); this mapping controls ONLY how they are labelled
 * for the patient. The safety penalty is intentionally not shown to the patient.
 */
type PatientQuality = 'Good' | 'Okay' | 'Keep trying';

const PATIENT_LABELS: Partial<Record<SessionMetricKind, string>> = {
  accuracy: 'Movement',
  pace: 'Pace',
  symmetry: 'Balance',
};

function qualityFor(value: number): PatientQuality {
  if (value >= 85) return 'Good';
  if (value >= 70) return 'Okay';
  return 'Keep trying';
}

export function getPatientFacingMetrics(result: SessionResult): { label: string; value: PatientQuality }[] {
  return result.metrics.flatMap((metric) => {
    const label = PATIENT_LABELS[metric.kind];
    return label ? [{ label, value: qualityFor(metric.value) }] : [];
  });
}

/** Simple rule-based feedback derived from the mock metric values. */
function buildMockFeedback(metrics: SessionMetric[]): string[] {
  const byKind = new Map(metrics.map((metric) => [metric.kind, metric.value]));
  const lines: string[] = [];

  const accuracy = byKind.get('accuracy') ?? 0;
  if (accuracy >= 85) {
    lines.push('Your simulated form suggests strong knee extension range.');
  } else if (accuracy >= 70) {
    lines.push('Keep extending until the leg is comfortably straight.');
  } else {
    lines.push('Use a smaller range of motion and build up gradually.');
  }

  const pace = byKind.get('pace') ?? 0;
  if (pace >= 85) {
    lines.push('Your simulated pace was steady and easy to follow.');
  } else {
    lines.push('Move a little slower and breathe at a calm rhythm.');
  }

  const symmetry = byKind.get('symmetry') ?? 0;
  if (symmetry >= 85) {
    lines.push('Both sides moved evenly — great balance.');
  } else {
    lines.push('Practice the gentler side a little more.');
  }

  const safety = byKind.get('safety') ?? 0;
  lines.push(
    safety <= 5
      ? 'No pain flags in the demo. Always stop if anything feels wrong.'
      : 'Take a break if you felt any discomfort during the session.',
  );

  return lines;
}

export function createMockAnalysisResult(exercise: Exercise): SessionResult {
  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    score: MOCK_OVERALL_SCORE,
    summary: MOCK_SUMMARY,
    status: 'demo-result',
    metrics: MOCK_METRICS,
    feedback: buildMockFeedback(MOCK_METRICS),
  };
}