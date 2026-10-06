import { check, suite } from './harness';

/*
 * The pose tracker is the only part of NOVEN that touches the camera at the
 * native level, and the one place where a privacy promise can be broken without
 * any TypeScript in the app ever seeing it. The Privacy screen tells the person
 * that nothing about them is kept; a Kotlin file that writes a frame to disk
 * breaks that promise while every JS test in this suite still passes.
 *
 * So this file reads the native sources and asserts the property that actually
 * matters: the module has no path by which camera imagery reaches storage. It is
 * a shape test over source text, because no Kotlin runs under `npm test` — the
 * same approach settings-navigation.test.ts and activity-flow.test.ts take for
 * screens the test build deliberately excludes.
 *
 * What is deliberately NOT asserted is that the module contains no Bitmap at
 * all. Turning a CameraX `ImageProxy` into an in-memory bitmap is the whole
 * point of ImageProxyUtils.toRotatedBitmap, and handing it to MediaPipe's
 * BitmapImageBuilder is how pose detection happens. In-memory use is the
 * product working. Persisting it is the defect, and these checks are written to
 * catch only the second.
 */

// The harness is zero-dependency and tsconfig.test.json has no `node` types, so
// the module reads are declared here rather than pulling in @types/node.
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean; isFile(): boolean }[];
  resolve(...segments: string[]): string;
};
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

// __dirname is the COMPILED test directory, so the module root is two levels up.
const MODULE_ROOT = resolve(__dirname, '../../modules/pose-tracker');
const VIEW_RELATIVE = 'android/src/main/java/expo/modules/posetracker/PoseTrackerView.kt';
const VIEW_PATH = resolve(MODULE_ROOT, VIEW_RELATIVE);

type SourceFile = { name: string; text: string };

/** Every Kotlin source in the module, so a regression cannot hide in a sibling file. */
function kotlinSources(dir: string): SourceFile[] {
  const found: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...kotlinSources(child));
    else if (entry.name.endsWith('.kt')) {
      found.push({ name: entry.name, text: readFileSync(child, 'utf8') });
    }
  }
  return found;
}

/** Removes comments, so a note ABOUT writing a file is not mistaken for one. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The offending line, so a failure says which file and which construct. */
function offendingLines(text: string, pattern: RegExp): string[] {
  return stripComments(text)
    .split('\n')
    .filter((line) => pattern.test(line))
    .map((line) => line.trim());
}

/**
 * A construct that moves bytes out of memory and onto storage. Each entry is
 * the way this module could persist a frame; none of them have a legitimate
 * reason to appear here, so each is checked by name.
 */
const PERSISTENCE_CONSTRUCTS: { what: string; pattern: RegExp }[] = [
  { what: 'a byte stream to a file', pattern: /OutputStream/ },
  { what: 'a file writer', pattern: /\bFileWriter\b|\bBufferedWriter\b/ },
  { what: 'a file constructed in code', pattern: /\bjava\.io\.File\b|\bFile\s*\(/ },
  { what: 'internal app storage', pattern: /\bfilesDir\b|\bcacheDir\b|\bexternalCacheDir\b/ },
  { what: 'external app storage', pattern: /getExternalFilesDir|getExternalStorageDirectory|getExternalStoragePublicDirectory/ },
  { what: 'a framework file write', pattern: /\bopenFileOutput\b|\bopenFileDescriptor\b/ },
  { what: 'image encoding, which is how a bitmap becomes a file', pattern: /\.compress\s*\(/ },
  { what: 'an image file extension', pattern: /\.(png|jpe?g|webp|bmp)\b/i },
];

/** Reading a frame out of the view, which is the step that feeds a write. */
const CAPTURE_CONSTRUCTS: { what: string; pattern: RegExp }[] = [
  { what: 'a bitmap pulled off a preview surface', pattern: /\.bitmap\b/ },
  { what: 'the removed preview-capture diagnostic', pattern: /dumpTextureBitmap/ },
  { what: 'the artefact that diagnostic wrote', pattern: /previewbitmap/i },
];

export function run(): void {
  suite('pose tracker native module: the camera path is found, so these checks are real', () => {
    const sources = kotlinSources(MODULE_ROOT);

    check('the module root exists and holds Kotlin sources', sources.length > 0, {
      moduleRoot: MODULE_ROOT,
      found: sources.length,
    });

    const names = sources.map((file) => file.name);
    for (const expected of ['PoseTrackerView.kt', 'PoseTrackerProcessor.kt', 'ImageProxyUtils.kt']) {
      check(`${expected} is among the scanned sources`, names.includes(expected), names);
    }
  });

  suite('pose tracker native module: camera imagery is never written to storage', () => {
    for (const file of kotlinSources(MODULE_ROOT)) {
      for (const { what, pattern } of PERSISTENCE_CONSTRUCTS) {
        const offending = offendingLines(file.text, pattern);
        check(`${file.name} uses no ${what}`, offending.length === 0, offending);
      }
    }
  });

  suite('pose tracker native module: the preview frame is never captured for saving', () => {
    const view = kotlinSources(MODULE_ROOT).find((file) => file.name === 'PoseTrackerView.kt');
    check('PoseTrackerView.kt was found', view !== undefined);

    for (const { what, pattern } of CAPTURE_CONSTRUCTS) {
      const offending = view ? offendingLines(view.text, pattern) : ['PoseTrackerView.kt not scanned'];
      check(`PoseTrackerView.kt uses no ${what}`, offending.length === 0, offending);
    }
  });

  suite('pose tracker native module: preview rendering was left untouched by the removal', () => {
    /*
     * The disk write was removed on its own. These two mutate CameraX's own
     * internal TextureView to make the preview fill correctly and cannot be
     * verified without a device, so this suite exists to stop a future cleanup
     * from quietly taking them out along with the logging.
     */
    const text = stripComments(readFileSync(VIEW_PATH, 'utf8'));

    check('applyScaleFillTransform still exists', /fun applyScaleFillTransform\s*\(/.test(text));
    check('forcePreviewChildLayout still exists', /fun forcePreviewChildLayout\s*\(/.test(text));
    check('TextureView handling is still present', /TextureView/.test(text));
    check('the diagnostics were not stripped', /\[DIAG-/.test(text));
  });
}
