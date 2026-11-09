import { parseKanjiSvg } from './parse';
import type { KanjiSvg } from './parse';

/**
 * Asset resolution for KanjiVG `.svg` files that live in the *user's* project.
 *
 * Nothing is pre-compiled: files are bundled raw (see README for the Metro
 * setup) and parsed at runtime. Two ways to point at a file:
 *
 * 1. Explicit file per component:
 *    `<Kanji file={require('./kanji/魂.svg')} />`
 *
 * 2. Character (or codepoint/filename) props resolved through a directory map:
 *    ```ts
 *    // somwhere in the app, with a folder path as a literal:
 *    const kanjis = createKanjiSource(require.context('./kanji', true, /\.svg$/));
 *    ```
 *    `<Kanji character="魂" source={kanjis} />`
 *
 * Directory-map keys are resolved in order: the file's basename without
 * extension (`魂`, `U6f22`, `06f22`, `hanako`, …), its codepoints
 * (`U6F22`, `06f22`, and the bare character itself when the basename is that
 * character), and finally the raw context key (`./魂.svg`).
 */

/** Structural type for Metro's `require.context(...)` result. */
export interface RequireContext {
  (id: string): unknown;
  keys(): string[];
  resolve?: (id: string) => unknown;
}

/** A required `.svg` module: raw string, `{ body }`, or a numeric asset id. */
export type KanjiFileInput =
  | string
  | number
  | { body?: string; default?: string };

export interface KanjiSource {
  /** Resolve a character / codepoint / basename / context key to an asset. */
  resolve(key: string): KanjiFileInput | undefined;
  /** All registered lookup keys (basenames, codepoint names, characters). */
  keys(): string[];
  /** Number of SVG files in the directory. */
  readonly size: number;
}

/** Parses a raw SVG module (string, `{ body }`, codegen module) to text. */
export function readSvgModule(mod: unknown, source: string): string {
  if (typeof mod === 'string') return mod;
  if (typeof mod === 'number') {
    return fail(
      source,
      'SVG files must be bundled as raw text, not as numeric assets. ' +
        'See the KanjiVG asset setup in the README (`.kanji.svg` extension or `sourceExts`).'
    );
  }
  if (mod != null && typeof mod === 'object') {
    const obj = mod as { body?: string; default?: unknown };
    if (typeof obj.body === 'string') return obj.body;
    if (typeof obj.default === 'string') return obj.default;
  }
  return fail(
    source,
    `unexpected SVG module (got ${typeof mod}); expected raw text or { body: string }`
  );
}

function fail(source: string, message: string): never {
  throw new Error(`react-native-kanjivg-tgfx (${source}): ${message}`);
}

/** Strip directory parts and extension: `./dir/魂.kanji.svg` -> `魂.kanji`. */
function basename(key: string): string {
  const tail = key.slice(key.lastIndexOf('/') + 1);
  const dot = tail.lastIndexOf('.');
  return dot > 0 ? tail.slice(0, dot) : tail;
}

function nameAliases(name: string): string[] {
  // KanjiVG filenames come in three spellings: the bare character (`魂.svg`),
  // a `U`-prefixed codepoint (`U9b42.svg`) or the bare hex codepoint
  // (`9b42.svg`). Register every spelling of the glyph for any of them.
  const aliases = new Set<string>([name, name.toLowerCase()]);
  const hexMatch = /^u?([0-9a-fA-F]{4,6})$/i.exec(name);
  if (hexMatch != null) {
    const hex = hexMatch[1]!.toLowerCase();
    const cp = Number.parseInt(hex, 16);
    try {
      aliases.add(String.fromCodePoint(cp));
    } catch {
      /* not a scalar value */
    }
    aliases.add(`U${hex.toUpperCase()}`);
    aliases.add(`U${hex}`);
    aliases.add(hex);
  }
  for (const ch of name) {
    const cp = ch.codePointAt(0);
    if (cp == null || cp < 0x80) continue; // skip ASCII noise
    aliases.add(ch);
    aliases.add(`U${cp.toString(16).toUpperCase()}`);
    aliases.add(`U${cp.toString(16)}`);
    aliases.add(cp.toString(16));
  }
  return [...aliases];
}

/**
 * Builds a lookup source over a Metro require-context of an SVG directory.
 * Call at app module scope so the directory path stays a static literal.
 */
export function createKanjiSource(
  contextOrModules: RequireContext | Record<string, unknown>
): KanjiSource {
  const entries: Array<{ key: string; mod: unknown }> = [];

  let contextRequire: ((id: string) => unknown) | undefined;
  if (typeof contextOrModules === 'function') {
    const context = contextOrModules as RequireContext;
    contextRequire = context;
    for (const key of context.keys()) {
      entries.push({ key, mod: undefined }); // lazily required below
    }
  } else {
    const modules = contextOrModules as Record<string, unknown>;
    for (const key of Object.keys(modules)) {
      entries.push({ key, mod: modules[key] });
    }
  }

  const index = new Map<string, number>();
  entries.forEach((entry, i) => {
    // `9b42.kanji.svg` -> base `9b42` so codepoint spellings still alias.
    const base = basename(entry.key).replace(/\.kanji$/i, '');
    const aliases = [entry.key, ...nameAliases(base)];
    for (const alias of aliases) {
      if (!index.has(alias)) index.set(alias, i);
    }
  });

  const modules = new Map<number, unknown>();
  const load = (i: number): unknown => {
    let mod = modules.get(i);
    if (mod === undefined) {
      const { key, mod: eager } = entries[i]!;
      mod = eager !== undefined ? eager : contextRequire!(key);
      modules.set(i, mod);
    }
    return mod;
  };

  return {
    resolve: (key) => {
      const normalized = key.replace(/^\.\/+/, './');
      const i =
        index.get(key) ??
        index.get(normalized) ??
        index.get(key.toLowerCase()) ??
        index.get(normalized.toLowerCase());
      return i === undefined ? undefined : (load(i) as KanjiFileInput);
    },
    keys: () => [...index.keys()],
    get size() {
      return entries.length;
    },
  };
}

/** Resolve any component `file`/`character` input to a raw SVG module. */
export function resolveKanjiAsset(
  file: KanjiFileInput | undefined,
  character: string | undefined,
  source: KanjiSource | undefined
): { mod: unknown; name: string } {
  if (file != null) {
    const name =
      typeof file === 'string' && file.length < 100 ? file : 'kanji.svg';
    return { mod: file, name };
  }
  if (character != null) {
    if (source == null) {
      fail(
        'Kanji',
        'pass `source` (see createKanjiSource) to look characters up by `character`'
      );
    }
    const mod = source.resolve(character);
    if (mod == null) {
      fail(
        'Kanji',
        `no SVG found for "${character}" in the provided source directory`
      );
    }
    return { mod, name: `"${character}"` };
  }
  return fail('Kanji', 'either `file` or `character` is required');
}

// ---------------------------------------------------------------- timing

/** Where a stroke lives on the 0..1 write-on timeline of the whole glyph. */
export interface KanjiStrokeTiming {
  /** Cumulative normalized start of this stroke, 0..1. */
  readonly start: number;
  /** Cumulative normalized end of this stroke, 0..1. */
  readonly end: number;
}

/**
 * Compute the handwriting timeline for a glyph: each stroke owns a segment of
 * the global 0..1 progress proportional to its geometric length, so a linear
 * clock draws long strokes at the same pen speed as short ones.
 *
 * Uses tgfx's `pathLength` when available and falls back to uniform durations
 * (e.g. in jest, where the native module is mocked).
 */
export function computeStrokeTimings(
  strokes: readonly string[]
): KanjiStrokeTiming[] {
  let lengths: number[];
  try {
    // Lazy require keeps this module importable without react-native-tgfx
    // (jest, tooling); the bundler keeps it a static edge via the literal id.
    const tgfx = require('react-native-tgfx') as {
      pathLength: (path: string) => number;
    };
    lengths = strokes.map((d) => Math.max(tgfx.pathLength(d), 1e-6));
  } catch {
    lengths = strokes.map(() => 1);
  }
  const total = lengths.reduce((sum, l) => sum + l, 0);
  let cursor = 0;
  return lengths.map((length) => {
    const start = cursor / total;
    cursor += length;
    return { start, end: cursor / total };
  });
}

// ---------------------------------------------------------------- caching

/** A parsed glyph plus its derived handwriting timeline. */
export interface LoadedKanji {
  readonly svg: KanjiSvg;
  readonly timings: KanjiStrokeTiming[];
}

const parseCache = new Map<string, LoadedKanji>();
const asyncCache = new Map<string, Promise<LoadedKanji>>();

/**
 * Parse an SVG file (module or source string), memoized by explicit `cacheKey`
 * (asset id / character). Async so future sources (remote download) can keep
 * the same call sites; today it resolves in the same tick for bundled text.
 */
export function loadKanjiSvg(
  input: { mod: unknown; name: string; cacheKey?: string | number } | string
): Promise<LoadedKanji> {
  if (typeof input === 'string') {
    const svg = parseKanjiSvg(input);
    return Promise.resolve({ svg, timings: computeStrokeTimings(svg.strokes) });
  }

  const { mod, name, cacheKey } = input;
  const ck = cacheKey != null ? String(cacheKey) : undefined;
  const isText =
    typeof mod === 'string' || (mod != null && typeof mod === 'object');
  if (ck != null && isText) {
    const hit = parseCache.get(ck);
    if (hit != null) return Promise.resolve(hit);
  }

  let pending = ck != null ? asyncCache.get(ck) : undefined;
  if (pending == null) {
    pending = Promise.resolve().then(() => {
      const svg = parseKanjiSvg(readSvgModule(mod, name), name);
      const loaded: LoadedKanji = {
        svg,
        timings: computeStrokeTimings(svg.strokes),
      };
      if (ck != null && isText) parseCache.set(ck, loaded);
      asyncCache.delete(ck!);
      return loaded;
    });
    if (ck != null && isText) asyncCache.set(ck, pending);
  }
  return pending;
}
