import { describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-tgfx', () => ({
  Canvas: 'Canvas',
  Group: 'Group',
  Path: 'Path',
  Text: 'Text',
}));

jest.mock('react-native-reanimated', () => ({
  useSharedValue: <T,>(value: T) => ({
    value,
    get: () => value,
    set: (next: T) => {
      value = next;
    },
  }),
  useDerivedValue: <T,>(fn: () => T) => ({ value: fn() }),
  withTiming: (to: number) => to,
  withRepeat: (animation: unknown) => animation,
  cancelAnimation: () => undefined,
  Easing: { linear: 'linear' },
}));

jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: () => void) => fn(),
  scheduleOnUI: (fn: (...args: never[]) => void, ...args: never[]) =>
    fn(...args),
}));

import { Kanji, computeWriteTiming } from '../Kanji';
import type { KanjiHandle } from '../Kanji';
import { createKanjiSource } from '../assets';

const SVG = `<svg viewBox="0 0 108 108">
  <g id="kvg:StrokePaths_065e5">
    <path id="kvg:065e5-s1" d="M1,1L2,2"/>
    <path id="kvg:065e5-s2" d="M3,3L4,4"/>
    <path id="kvg:065e5-s3" d="M5,5L6,6"/>
  </g>
  <g id="kvg:StrokeNumbers_065e5"><text>1</text><text>2</text><text>3</text></g>
</svg>`;

function strokePathsOf(view: Awaited<ReturnType<typeof render>>) {
  return view.root!.queryAll((node) => node.props.style === 'stroke');
}

describe('<Kanji />', () => {
  it('renders each stroke plus the ghost layer', async () => {
    const view = await render(<Kanji file={SVG} width={108} height={108} />);
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(4); // 3 strokes + ghost
    });
  });

  it('hides the ghost layer with background={false}', async () => {
    const view = await render(<Kanji file={SVG} background={false} />);
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(3);
    });
  });

  it('applies per-stroke overrides by 1-based number', async () => {
    const view = await render(
      <Kanji
        file={SVG}
        background={false}
        strokes={{ 2: { color: '#ff0000' } }}
      />
    );
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(3);
    });
    const colors = strokePathsOf(view).map((p) => p.props.color);
    expect(colors).toEqual(['#000000', '#ff0000', '#000000']);
  });

  it('letterboxes the glyph with a Group transform', async () => {
    const view = await render(<Kanji file={SVG} width={200} height={100} />);
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(4);
    });
    const [group] = view.root!.queryAll((n) => n.props.transform != null);
    expect(group).toBeDefined();
    const [tx, ty, scale] = group!.props.transform;
    expect(tx).toEqual({ translateX: 50 });
    expect(ty).toEqual({ translateY: 0 });
    expect(scale).toEqual({ scale: 100 / 108 });
  });

  it('resolves characters through a KanjiSource', async () => {
    const source = createKanjiSource({ './065e5.svg': SVG });
    const view = await render(
      <Kanji character="日" source={source} background={false} />
    );
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(3);
    });
  });

  it('renders stroke-order numbers when asked', async () => {
    const numbered = SVG.replace(
      '<g id="kvg:StrokeNumbers_065e5"><text>1</text><text>2</text><text>3</text></g>',
      '<g id="kvg:StrokeNumbers_065e5">' +
        '<text transform="matrix(1 0 0 1 10 20)">1</text>' +
        '<text transform="matrix(1 0 0 1 30 40)">2</text>' +
        '<text x="50" y="60">3</text></g>'
    );
    const view = await render(
      <Kanji file={numbered} showStrokeNumbers background={false} />
    );
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(3);
    });
    const labels = view.root!.queryAll((n) => typeof n.props.text === 'string');
    expect(labels.map((l) => l.props.text)).toEqual(['1', '2', '3']);
    expect(labels[0]!.props.x).toBe(10);
    expect(labels[2]!.props.y).toBe(60);
  });

  it('hides strokes flagged visible:false (also from the ghost)', async () => {
    const view = await render(
      <Kanji file={SVG} strokes={{ 2: { visible: false } }} />
    );
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(3); // 2 visible strokes + ghost
    });
    const ghost = strokePathsOf(view).find(
      (p) =>
        String(p.props.path).includes('  ') ||
        String(p.props.path).split('M').length > 2
    );
    expect(ghost).toBeDefined();
    expect(String(ghost!.props.path)).not.toContain('M3,3L4,4');
  });

  it('hides a stroke number via strokeNumbers override', async () => {
    const numbered = SVG.replace(
      '<g id="kvg:StrokeNumbers_065e5"><text>1</text><text>2</text><text>3</text></g>',
      '<g id="kvg:StrokeNumbers_065e5">' +
        '<text transform="matrix(1 0 0 1 1 2)">1</text>' +
        '<text transform="matrix(1 0 0 1 3 4)">2</text>' +
        '<text transform="matrix(1 0 0 1 5 6)">3</text></g>'
    );
    const view = await render(
      <Kanji
        file={numbered}
        showStrokeNumbers
        background={false}
        strokes={{ 2: { visible: false } }}
        strokeNumbers={{ 3: { color: '#ff0000', fontSize: 12 } }}
      />
    );
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(2); // 2 strokes, no ghost
    });
    const labels = view.root!.queryAll((n) => typeof n.props.text === 'string');
    expect(labels.map((l) => l.props.text)).toEqual(['1', '3']); // label follows hidden stroke
    const third = labels.find((l) => l.props.text === '3')!;
    expect(third.props.color).toBe('#ff0000');
    expect(third.props.fontSize).toBe(12);
  });

  it('omits stroke numbers by default', async () => {
    const view = await render(<Kanji file={SVG} background={false} />);
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(3);
    });
    const labels = view.root!.queryAll((n) => typeof n.props.text === 'string');
    expect(labels).toHaveLength(0);
  });

  it('sizes the wrapping view to the requested box', async () => {
    const view = await render(<Kanji file={SVG} width={42} height={43} />);
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(4);
    });
    const json = view.toJSON() as unknown as { props: { style: unknown } };
    expect(json.props.style).toEqual([undefined, { width: 42, height: 43 }]);
  });
});

describe('<Kanji /> animation mode', () => {
  it('trims strokes against the shared clock when animated', async () => {
    const view = await render(<Kanji file={SVG} animated background={false} />);
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(3);
    });
    const trimmed = view.root!.queryAll(
      (n) => n.props.style === 'stroke' && n.props.start === 0
    );
    expect(trimmed).toHaveLength(3);
    for (const path of trimmed) {
      expect(typeof path.props.end).toBe('object'); // derived shared value
    }
  });

  it('keeps strokes static without `animated`', async () => {
    const view = await render(<Kanji file={SVG} background={false} />);
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(3);
    });
    const trimmed = view.root!.queryAll((n) => n.props.start === 0);
    expect(trimmed).toHaveLength(0);
  });

  it('exposes imperative play/seek control through the ref', async () => {
    let playing = false;
    const handle: { current: KanjiHandle | null } = { current: null };
    const view = await render(
      <Kanji
        file={SVG}
        animated
        background={false}
        ref={(h) => {
          handle.current = h;
        }}
      />
    );
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(3);
    });
    expect(handle.current?.isPlaying()).toBe(false);
    handle.current?.play();
    expect(handle.current?.isPlaying()).toBe(true);
    handle.current?.pause();
    expect(handle.current?.isPlaying()).toBe(false);
    expect(() => handle.current?.seekTo(2)).not.toThrow(); // clamped
    void playing;
  });

  it('re-arms the driver when speed changes mid-write', async () => {
    const handle: { current: KanjiHandle | null } = { current: null };
    const view = await render(
      <Kanji
        file={SVG}
        animated
        background={false}
        ref={(h) => {
          handle.current = h;
        }}
      />
    );
    await waitFor(() => {
      expect(strokePathsOf(view)).toHaveLength(3);
    });
    handle.current?.play();
    handle.current?.setSpeed(2);
    expect(handle.current?.isPlaying()).toBe(true); // paused+replayed, not stopped
    handle.current?.setStrokeSpeed(2, 0.5);
    expect(handle.current?.isPlaying()).toBe(true);
    handle.current?.pause();
  });
});

describe('computeWriteTiming', () => {
  const T = [
    { start: 0, end: 1 / 3 },
    { start: 1 / 3, end: 2 / 3 },
    { start: 2 / 3, end: 1 },
  ];
  const ALL = [true, true, true];
  const NONE = [1, 1, 1];

  it('keeps the baseline plan untouched at speed 1', () => {
    const { segments, totalMs } = computeWriteTiming(T, ALL, NONE, 900, 1);
    expect(totalMs).toBe(900);
    expect(segments![0]).toEqual({ start: 0, end: 1 / 3 });
    expect(segments![2]!.end).toBeCloseTo(1);
  });

  it('divides the pass duration by the global speed', () => {
    const { totalMs } = computeWriteTiming(T, ALL, NONE, 900, 3);
    expect(totalMs).toBe(300);
  });

  it("gives a fast stroke's time back to the others", () => {
    const { segments, totalMs } = computeWriteTiming(T, ALL, [1, 2, 1], 750, 1);
    // weights 1, .5, 1 over 2.5
    expect(totalMs).toBeCloseTo(750 * (2.5 / 3));
    expect(segments![1]!.start).toBeCloseTo(1 / 2.5);
    expect(segments![1]!.end).toBeCloseTo(1.5 / 2.5);
  });

  it('drops hidden strokes and reweights around them', () => {
    const { segments, totalMs } = computeWriteTiming(
      T,
      [true, false, true],
      NONE,
      600,
      1
    );
    expect(segments![1]).toBeUndefined();
    expect(segments![2]!.start).toBeCloseTo(0.5);
    expect(segments![2]!.end).toBeCloseTo(1);
    expect(totalMs).toBeCloseTo(400); // only 2/3 of the glyph remains
  });

  it('clamps insane speeds instead of producing Infinity', () => {
    const { totalMs } = computeWriteTiming(T, ALL, [1, 1e9, 1], 900, 1);
    expect(Number.isFinite(totalMs)).toBe(true);
  });
});
