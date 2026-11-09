import { describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-tgfx', () => ({
  Canvas: 'Canvas',
  Group: 'Group',
  Path: 'Path',
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

import { Kanji } from '../Kanji';
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
});
