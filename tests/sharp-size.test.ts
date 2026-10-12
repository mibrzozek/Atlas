import { getSharpSize } from '../common/sharp-size';

// A photo from a 20 megapixel camera, and the same one held upright. Thumbnails are 600 pixels at most
const landscape = { width: 5472, height: 3648, extension: 'jpg' };
const portrait = { width: 3648, height: 5472, extension: 'jpg' };

describe('getSharpSize', () => {
  it('needs nothing more than the thumbnail for small cells', () => {
    expect(getSharpSize(landscape, 240, 160, 'contain', 1)).toBeUndefined();
    expect(getSharpSize(landscape, 600, 400, 'contain', 1)).toBeUndefined();
  });

  it('counts the pixels of the screen, not of the page', () => {
    // 500 wide on a display at 130% is 650 pixels: more than a thumbnail has
    expect(getSharpSize(landscape, 500, 333, 'contain', 1)).toBeUndefined();
    expect(getSharpSize(landscape, 500, 333.33, 'contain', 1.3)).toEqual({
      width: 650,
      height: 433,
    });
  });

  it('counts the short side when the image fills a square cell', () => {
    // The 400 pixel short side of the thumbnail would be stretched over 500 pixels
    expect(getSharpSize(landscape, 500, 500, 'cover', 1)).toEqual({ width: 750, height: 500 });
    expect(getSharpSize(portrait, 500, 500, 'cover', 1)).toEqual({ width: 500, height: 750 });
    // Shown whole in the same cell, the thumbnail is enough
    expect(getSharpSize(landscape, 500, 500, 'contain', 1)).toBeUndefined();
  });

  it('asks for exactly the pixels the image covers, in its own shape', () => {
    const size = getSharpSize(landscape, 700, 700, 'cover', 1.3);
    expect(size).toEqual({ width: 1365, height: 910 });
    expect(size!.width / size!.height).toBeCloseTo(1.5, 2);
  });

  it('never asks for more than the image has', () => {
    const small = { width: 800, height: 600, extension: 'png' };
    expect(getSharpSize(small, 2000, 1500, 'contain', 2)).toEqual({ width: 800, height: 600 });
    // An image no larger than a thumbnail is its own thumbnail
    expect(
      getSharpSize({ width: 500, height: 400, extension: 'png' }, 2000, 1600, 'contain', 2),
    ).toBeUndefined();
  });

  it('leaves room around the image when asked to, like the collage does', () => {
    expect(getSharpSize(landscape, 1000, 1000, 'contain', 1, 0.88)).toEqual({
      width: 880,
      height: 587,
    });
  });

  it('leaves formats that cannot be decoded in the background alone', () => {
    for (const extension of ['tif', 'psd', 'exr', 'gif', 'svg']) {
      expect(
        getSharpSize({ width: 5000, height: 4000, extension }, 900, 900, 'cover', 2),
      ).toBeUndefined();
    }
    expect(
      getSharpSize({ width: 0, height: 0, extension: 'jpg' }, 900, 900, 'cover', 2),
    ).toBeUndefined();
  });
});
