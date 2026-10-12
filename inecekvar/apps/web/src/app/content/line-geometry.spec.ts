import { LineSketch, projectLine } from './line-geometry';

function checkSketch(sketch: LineSketch | null): asserts sketch is LineSketch {
  expect(sketch).not.toBeNull();
  if (!sketch) throw new Error('Missing sketch');
  expect(sketch.pathD).toMatch(/^M [-0-9. ]+( L [-0-9. ]+)*$/);
  const numbers = sketch.pathD.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  for (let i = 0; i < numbers.length; i++) {
    const value = numbers[i];
    if (value === undefined) throw new Error('Missing coordinate');
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(i % 2 === 0 ? sketch.width : sketch.height);
  }
  for (const stop of sketch.stops) {
    expect(stop.cx).toBeGreaterThanOrEqual(0);
    expect(stop.cx).toBeLessThanOrEqual(sketch.width);
    expect(stop.cy).toBeGreaterThanOrEqual(0);
    expect(stop.cy).toBeLessThanOrEqual(sketch.height);
    expect(stop.cx).toBe(Number(stop.cx.toFixed(2)));
    expect(stop.cy).toBe(Number(stop.cy.toFixed(2)));
  }
}

describe('line projection', () => {
  it('projects a square with uniform scale and inverted latitude', () => {
    const sketch = projectLine(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      [{ location: [-1, -1] }, { location: [1, 1] }],
    );
    checkSketch(sketch);
    expect(sketch).toEqual({
      width: 640,
      height: 360,
      viewBox: '0 0 640 360',
      pathD: 'M 164 336 L 476 336 L 476 24 L 164 24',
      stops: [
        { cx: 164, cy: 336 },
        { cx: 476, cy: 24 },
      ],
    });
  });

  it('centers horizontal and vertical lines', () => {
    const horizontal = projectLine(
      [
        [0, 0],
        [2, 0],
      ],
      [],
    );
    const vertical = projectLine(
      [
        [0, 0],
        [0, 2],
      ],
      [],
    );
    checkSketch(horizontal);
    checkSketch(vertical);
    expect(horizontal.pathD).toBe('M 24 180 L 616 180');
    expect(vertical.pathD).toBe('M 320 336 L 320 24');
  });

  it.each([
    { coordinates: [] },
    { coordinates: [[0, 0]] },
    {
      coordinates: [
        [1, 1],
        [1, 1],
      ],
    },
    {
      coordinates: [
        [NaN, 0],
        [1, 1],
      ],
    },
    {
      coordinates: [
        [0, 0],
        [Infinity, 0],
      ],
    },
    {
      coordinates: [
        [0, 0],
        [0, -Infinity],
      ],
    },
    {
      coordinates: [
        [0, 0],
        [181, 0],
      ],
    },
    {
      coordinates: [
        [0, 0],
        [0, -91],
      ],
    },
    { coordinates: [[0, 0], [1]] },
    {
      coordinates: [
        [0, 0],
        [1, 1, 1],
      ],
    },
  ])('rejects incomplete or invalid geometry $coordinates', ({ coordinates }) => {
    expect(projectLine(coordinates, [])).toBeNull();
  });

  it('uses the mid-latitude cosine for longitude distances', () => {
    const sketch = projectLine(
      [
        [0, 59],
        [2, 61],
      ],
      [],
      { width: 400, height: 400, padding: 20 },
    );
    checkSketch(sketch);
    expect(sketch.pathD).toBe('M 110 380 L 290 20');
  });

  it('keeps only valid stops and rounds their coordinates', () => {
    const sketch = projectLine(
      [
        [0, 0],
        [2, 0],
      ],
      [
        { location: [0.123456, 0] },
        { location: [NaN, 0] },
        { location: [181, 0] },
        { location: [1, 1, 1] },
        { location: [180, 90] },
      ],
    );
    checkSketch(sketch);
    expect(sketch.stops).toHaveLength(2);
    expect(sketch.stops[0]).toEqual({ cx: 60.54, cy: 180 });
  });

  it('downsamples evenly while preserving both endpoints and the full extent', () => {
    const coordinates = Array.from({ length: 30000 }, (_, i) => [i / 1000, 0]);
    const sketch = projectLine(coordinates, []);
    checkSketch(sketch);
    expect(sketch.pathD.match(/(?:^M| L) /g)).toHaveLength(400);
    expect(sketch.pathD.startsWith('M 24 180 ')).toBe(true);
    expect(sketch.pathD.endsWith('L 616 180')).toBe(true);
    const peak = Array.from({ length: 1000 }, (_, i) => [i / 1000, i === 501 ? 2 : 0]);
    const extent = projectLine(peak, []);
    checkSketch(extent);
    expect(extent.pathD.startsWith('M 242.09 336 ')).toBe(true);
  });

  it.each([{ width: 0 }, { height: NaN }, { width: Infinity }, { padding: -1 }, { padding: 180 }])(
    'rejects unusable dimensions %s',
    (options) => {
      expect(
        projectLine(
          [
            [0, 0],
            [1, 1],
          ],
          [],
          options,
        ),
      ).toBeNull();
    },
  );

  it('keeps 50 fixed-seed lines bounded and deterministic', () => {
    let seed = 123456;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 50; i++) {
      const coordinates = Array.from({ length: 2 + Math.floor(random() * 900) }, () => [
        -170 + random() * 340,
        -80 + random() * 160,
      ]);
      const stops = coordinates.slice(0, 5).map((location) => ({ location }));
      const options = {
        width: 200 + Math.floor(random() * 1000),
        height: 200 + Math.floor(random() * 600),
        padding: 24,
      };
      const sketch = projectLine(coordinates, stops, options);
      checkSketch(sketch);
      expect(sketch.pathD.match(/(?:^M| L) /g)?.length).toBeLessThanOrEqual(400);
      expect(projectLine(coordinates, stops, options)).toEqual(sketch);
    }
  });
});
