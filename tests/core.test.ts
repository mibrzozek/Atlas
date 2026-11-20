import { besideLeft } from '../common/core';

describe('besideLeft', () => {
  it('puts a box to the right of its anchor, when there is room', () => {
    expect(besideLeft({ left: 100, right: 300 }, 200, 1000, 8)).toBe(308);
  });

  it('puts it to the left when only there is room, and keeps it in the window', () => {
    // To the right it would run past the window's edge: to the left it lies beside the anchor
    expect(besideLeft({ left: 600, right: 900 }, 200, 1000, 8)).toBe(392);
  });

  it('takes the side that lies over the anchor least when neither has room', () => {
    // Right: kept in the window, 290 units over the anchor; left: 300 units over it
    expect(besideLeft({ left: 0, right: 990 }, 300, 1000, 8)).toBe(700);
  });
});
