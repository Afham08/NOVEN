/**
 * Minimal zero-dependency test harness. Node runs a compiled entrypoint that
 * calls each suite; any `check` that fails is printed and the process exits 1.
 *
 * Suites may be synchronous or asynchronous. A synchronous suite runs inline,
 * exactly as it always has, so nothing about the existing suites changes. An
 * asynchronous one is tracked and awaited by `awaitAllSuites()` before the
 * entrypoint reports, which is what lets the persistence suites exercise the
 * real promise-based store. Async suites are serialized through a chain so
 * exactly one of them is ever suspended at a time, which is what keeps a
 * failure attributed to the suite that produced it.
 */

type Failure = { suite: string; name: string; detail: unknown };

const failures: Failure[] = [];
let currentSuite = '';
let suiteCount = 0;
let checkCount = 0;
let asyncChain: Promise<void> = Promise.resolve();

function isThenable(value: unknown): value is Promise<void> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<void>).then === 'function';
}

export function suite(name: string, fn: () => void | Promise<void>): void {
  suiteCount += 1;
  currentSuite = name;
  let result: void | Promise<void>;
  try {
    result = fn();
  } catch (error) {
    failures.push({ suite: name, name: '(suite threw)', detail: error });
    currentSuite = '';
    return;
  }
  currentSuite = '';
  if (!isThenable(result)) return;

  asyncChain = asyncChain.then(async () => {
    // Re-asserted because a synchronous suite that ran after this one started
    // would have reset the name before the continuation resumed.
    currentSuite = name;
    try {
      await result;
    } catch (error) {
      failures.push({ suite: name, name: '(suite threw)', detail: error });
    } finally {
      currentSuite = '';
    }
  });
}

/** Resolves once every asynchronous suite has finished. */
export function awaitAllSuites(): Promise<void> {
  return asyncChain;
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
    console.error(`FAIL [${failure.suite}] ${failure.name}: ${formatDetail(failure.detail)}`);
  }
  console.log(`SUITES: ${suiteCount}`);
  console.log(`CHECKS: ${checkCount}`);
  console.log(`RESULT: ${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILURE(S)`}`);
  return failures.length;
}

/**
 * Renders a failure detail for the console.
 *
 * JSON.stringify turns an Error into "{}", because a thrown Error has no
 * enumerable own properties, so a suite that died on a bad path used to report
 * nothing but braces. Errors are unwrapped to their message and stack here, and
 * the first stack line is kept because the throwing line is the one thing
 * needed to fix it.
 */
function formatDetail(detail: unknown): string {
  if (detail instanceof Error) {
    const firstFrame = detail.stack?.split('\n').find((line) => line.trim().startsWith('at '));
    return `${detail.name}: ${detail.message}${firstFrame ? `\n    ${firstFrame.trim()}` : ''}`;
  }
  try {
    return JSON.stringify(detail) ?? String(detail);
  } catch {
    return String(detail);
  }
}