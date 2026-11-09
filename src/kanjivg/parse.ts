/**
 * Minimal, dependency-free parser for KanjiVG-style SVG files.
 *
 * KanjiVG files are highly regular: every stroke is a `<path>` inside a group
 * whose id is `kvg:StrokePaths_<codepoint>`, listed in stroke order, and
 * stroke ids (when present) look like `kvg:065e5-s1` (current datasets) or
 * `kvg:065e5-1` (legacy ones). The trailing "StrokeNumbers" group contains one
 * `<text>` label per stroke, which doubles as a consistency check.
 *
 * Only the pieces this renderer needs are extracted (viewBox + stroke `d`
 * strings); radical grouping, stroke-type metadata and number positions are
 * intentionally ignored.
 */

export interface KanjiSvg {
  /** SVG viewBox attribute, e.g. `0 0 109 109`. */
  readonly viewBox: string;
  /** Stroke path data (`d` attributes) in stroke order. */
  readonly strokes: readonly string[];
}

function fail(source: string, message: string): never {
  throw new Error(`${source}: ${message}`);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, ref: string) => {
      if (ref[0] === '#') {
        const code =
          ref[1] === 'x' || ref[1] === 'X'
            ? Number.parseInt(ref.slice(2), 16)
            : Number.parseInt(ref.slice(1), 10);
        if (Number.isFinite(code)) {
          try {
            return String.fromCodePoint(code);
          } catch {
            return match;
          }
        }
        return match;
      }
      const named = ENTITIES[ref.toLowerCase()];
      return named ?? match;
    }
  );
}

/**
 * Extracts the viewBox and stroke `d` strings from a raw KanjiVG SVG document.
 *
 * Stroke order is document order. When stroke ids are present their numeric
 * suffixes must form the sequence 1..N, and when a "StrokeNumbers" group is
 * present its label count must match the path count — malformed or
 * non-KanjiVG SVGs should fail loudly here rather than render with shuffled
 * or truncated strokes.
 *
 * @param xml    raw SVG file contents
 * @param source label (usually the file name) used in thrown error messages
 */
export function parseKanjiSvg(xml: string, source = 'kanji svg'): KanjiSvg {
  const svgMatch = /<svg\b[^>]*\bviewBox="([^"]*)"/i.exec(xml);
  if (svgMatch == null) {
    return fail(source, 'no <svg viewBox="..."> element found');
  }
  const viewBox = svgMatch[1]!;

  // Restrict the path scan to the stroke group when the markers exist.
  const startsAt = xml.indexOf('StrokePaths');
  const endsAt = xml.indexOf('StrokeNumbers');
  const section =
    startsAt >= 0
      ? xml.slice(startsAt, endsAt > startsAt ? endsAt : xml.length)
      : xml;

  const strokes: string[] = [];
  const numbers: number[] = [];
  const pathTagRe = /<path\b[^>]*/gi;
  let tag: RegExpExecArray | null;
  while ((tag = pathTagRe.exec(section)) !== null) {
    const attrs = tag[0];
    const d = /\bd="([^"]*)"/.exec(attrs);
    if (d == null) {
      return fail(source, 'found a <path> element without a d attribute');
    }
    strokes.push(decodeEntities(d[1]!));

    const id = /\bid="([^"]*)"/.exec(attrs);
    if (id != null) {
      const strokeNo = /-(?:s)?([0-9]+)$/.exec(id[1]!);
      if (strokeNo == null) {
        return fail(source, `unexpected stroke path id "${id[1]}"`);
      }
      numbers.push(Number.parseInt(strokeNo[1]!, 10));
    }
  }

  if (strokes.length === 0) {
    return fail(source, 'no stroke <path> elements found');
  }

  const numbersAt = xml.indexOf('StrokeNumbers');
  if (numbersAt >= 0) {
    let numberCount = 0;
    const textRe = /<text\b/gi;
    while (textRe.exec(xml.slice(numbersAt)) !== null) numberCount += 1;
    if (numberCount !== strokes.length) {
      return fail(
        source,
        `stroke-number labels (${numberCount}) do not match stroke paths (${strokes.length})`
      );
    }
  }

  if (numbers.length === strokes.length) {
    for (let i = 0; i < numbers.length; i += 1) {
      if (numbers[i] !== i + 1) {
        return fail(
          source,
          `stroke ids are not the sequential 1..${strokes.length} sequence (got ${numbers.join(',')})`
        );
      }
    }
  } else if (numbers.length > 0) {
    return fail(
      source,
      `only ${numbers.length} of ${strokes.length} stroke paths carry an id`
    );
  }

  return { viewBox, strokes };
}

/** Parses an SVG `viewBox` string ("minx miny width height") into a rect. */
export interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function parseViewBox(viewBox: string, source = 'viewBox'): ViewBox {
  const nums = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [x, y, width, height] = nums;
  if (
    nums.length !== 4 ||
    nums.some((n) => !Number.isFinite(n)) ||
    (width as number) <= 0 ||
    (height as number) <= 0
  ) {
    return fail(source, `invalid viewBox "${viewBox}"`);
  }
  return {
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
  };
}
