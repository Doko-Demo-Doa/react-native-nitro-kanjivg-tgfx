import { describe, expect, it } from '@jest/globals';

import { parseKanjiSvg, parseViewBox } from '../parse';

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg"
   xmlns:kvg="http://kanjivg.tagaini.net"
   id="9b42" width="108" height="108" viewBox="0 0 108 108">
  <g inkscape:label="魂" id="g9">
    <g id="kvg:StrokePaths_09b42" style="fill:none;stroke:#000000;stroke-width:3;stroke-linejoin:round;stroke-linecap:round;">
      <g id="kvg:09b42" kvg:element="魂">
        <g id="kvg:09b42-g1" kvg:element="云" kvg:position="top">
          <path id="kvg:09b42-s1" kvg:type="㇒" d="M19.75,41.13c..."/>
          <path id="kvg:09b42-s2" kvg:type="㇖" d="M34.5,17.88c...Z"/>
        </g>
        <g id="kvg:09b42-g3" kvg:element="鬼">
          <path id="kvg:09b42-s3" kvg:type="㇕" d="M47.12,14.75c..."/>
        </g>
      </g>
    </g>
    <g id="kvg:StrokeNumbers_09b42" style="font-size:8;fill:#808080">
      <text transform="matrix(1 0 0 1 13.75 43.13)">1</text>
      <text transform="matrix(1 0 0 1 27.50 18.13)">2</text>
      <text transform="matrix(1 0 0 1 39.25 14.13)">3</text>
    </g>
  </g>
</svg>`;

function svgWith(strokes: string, numbers = 3): string {
  const labels = Array.from(
    { length: numbers },
    (_, i) => `<text transform="matrix(1 0 0 1 1 1)">${i + 1}</text>`
  ).join('');
  return `<svg viewBox="0 0 108 108"><g id="kvg:StrokePaths_09b42">${strokes}</g><g id="kvg:StrokeNumbers_09b42">${labels}</g></svg>`;
}

describe('parseKanjiSvg', () => {
  it('extracts strokes in document order', () => {
    const svg = parseKanjiSvg(SAMPLE, '09b42.svg');
    expect(svg.strokes).toHaveLength(3);
    expect(svg.strokes[0]).toMatch(/^M19\.75,41\.13/);
    expect(svg.strokes[1]).toMatch(/Z$/);
    expect(svg.strokes[2]).toMatch(/^M47\.12,14\.75/);
    expect(svg.viewBox).toBe('0 0 108 108');
  });

  it('decodes XML entities in path data', () => {
    const svg = parseKanjiSvg(
      svgWith('<path id="a-s1" d="M1,2&amp;3&lt;4"/>', 1),
      'x'
    );
    expect(svg.strokes).toEqual(['M1,2&3<4']);
  });

  it('works with files that have no stroke ids (document order only)', () => {
    const svg = parseKanjiSvg(
      svgWith('<path d="M0,0L1,1"/><path d="M2,2L3,3"/>', 2),
      'x'
    );
    expect(svg.strokes).toEqual(['M0,0L1,1', 'M2,2L3,3']);
  });

  it('rejects mis-numbered stroke ids', () => {
    expect(() =>
      parseKanjiSvg(
        svgWith(
          '<path id="kvg:09b42-s1" d="M0,0"/><path id="kvg:09b42-s3" d="M1,1"/>',
          2
        ),
        'bad.svg'
      )
    ).toThrow(/bad\.svg/);
  });

  it('rejects stroke count mismatching the number labels', () => {
    const svg = `<svg viewBox="0 0 108 108">
      <g id="kvg:StrokePaths_09b42"><path id="kvg:09b42-s1" d="M0,0"/></g>
      <g id="kvg:StrokeNumbers_09b42"><text>1</text><text>2</text></g>
    </svg>`;
    expect(() => parseKanjiSvg(svg, 'mismatch.svg')).toThrow(
      /stroke-number labels/
    );
  });

  it('rejects SVGs without a StrokePaths group', () => {
    expect(() =>
      parseKanjiSvg('<svg viewBox="0 0 9 9"></svg>', 'empty.svg')
    ).toThrow(/stroke <path>/);
  });

  it('rejects path-less groups', () => {
    expect(() =>
      parseKanjiSvg(
        '<svg viewBox="0 0 9 9"><g id="kvg:StrokePaths_x"/></svg>',
        'x.svg'
      )
    ).toThrow(/stroke <path>/);
  });
});

describe('parseViewBox', () => {
  it('parses comma and space separated values', () => {
    expect(parseViewBox('0 0 108 108')).toEqual({
      x: 0,
      y: 0,
      width: 108,
      height: 108,
    });
    expect(parseViewBox(' -1.5 2.5 10 20 ')).toEqual({
      x: -1.5,
      y: 2.5,
      width: 10,
      height: 20,
    });
  });
  it('rejects malformed values', () => {
    expect(() => parseViewBox('0 0 108')).toThrow(/nvalid viewBox/);
    expect(() => parseViewBox('0 0 0 108')).toThrow(/nvalid viewBox/);
  });
});
