/**
 * Ambient declarations for the web-only CSS imports.
 *
 * `src/constants/theme.ts` imports '@/global.css' as a side effect (web styling
 * that Metro's native pipeline ignores) and `animated-icon.web.tsx` imports a
 * CSS module. Both files exist on disk, but TypeScript has no built-in notion
 * of CSS, so without these declarations `npx tsc --noEmit` fails on the two
 * web-only imports even though every native and test build compiles cleanly.
 *
 * Declared narrowly (`.css` and `.module.css`) rather than globally, so nothing
 * else about module resolution is loosened.
 */

/** CSS module: named classes are the export, keyed and readable. */
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

/** Plain side-effect stylesheet import; it has no runtime value on native. */
declare module '*.css';
