import { contrast, keepsOwnColoursOn, parseColour } from '../common/logo-colours';

describe('keepsOwnColoursOn', () => {
  it('keeps the logo its own colours on the dark backgrounds of the themes', () => {
    // Dark, Dimmed (dark, the closest: its blue is 3.3:1), Alien, Midnight purple
    for (const background of [
      [28, 30, 35],
      [45, 49, 57],
      [10, 10, 10],
      [4, 8, 20],
    ] as const) {
      expect(keepsOwnColoursOn([...background])).toBe(true);
    }
  });

  it('gives it the colours of the theme on light and middling backgrounds', () => {
    // Light, Dimmed (light), Gray not, Murder, Paper pink
    for (const background of [
      [240, 240, 240],
      [217, 217, 217],
      [153, 153, 153],
      [200, 200, 200],
      [242, 172, 200],
    ] as const) {
      expect(keepsOwnColoursOn([...background])).toBe(false);
    }
  });
});

describe('parseColour', () => {
  it('reads the colours CSS writes', () => {
    expect(parseColour('rgb(28, 30, 35)')).toEqual([28, 30, 35]);
    expect(parseColour(' rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3]);
    expect(parseColour('#147df1')).toEqual([20, 125, 241]);
    expect(parseColour('#fff')).toEqual([255, 255, 255]);
    expect(parseColour('var(--x)')).toBeUndefined();
  });

  it('measures contrast as WCAG does', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);
    expect(contrast([20, 125, 241], [28, 30, 35])).toBeCloseTo(4.2, 1);
  });
});
