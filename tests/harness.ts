/**
 * Minimal zero-dependency test harness. Node runs a compiled entrypoint that
 * calls each suite; any `check` that fails is printed and the process exits 1.
 */

type Failure = { suite: string; name: string; detail: unknown };

const failures: Failure[] = [];
let currentSuite = '';
let suiteCount = 0;
let checkCount = 0;

export function suite(name: string, fn: () => void): void {
  currentSuite = name;
  suiteCount += 1;
  try {
    fn();
  } catch (error) {
    failures.push({ suite: name, name: '(suite threw)', detail: error });
  }
  currentSuite = '';
}

export function check(name: string, condition: boolean, detail?: unknown): void {
  checkCount += 1;
  if (!condition) {
    failures.push({ suite: currentSuite, name, detail: detail ?? 'condition was false' });
  }
}

export function almostEqual(actual: number, expected: number, epsilon = 1e-6): void {
  check(
    `almostEqual(${actual}) ~= ${expected}`,
    Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon,
    { actual, expected, epsilon },
  );
}

/** Returns the number of failures; the entrypoint uses it as the exit code. */
export function report(): number {
  for (const failure of failures) {
    console.error(`FAIL [${failure.suite}] ${failure.name}: ${JSON.stringify(failure.detail)}`);
  }
  console.log(`SUITES: ${suiteCount}`);
  console.log(`CHECKS: ${checkCount}`);
  console.log(`RESULT: ${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILURE(S)`}`);
  return failures.length;
}