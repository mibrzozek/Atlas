import { STARTUP_TIMING, startupDelay, startupPhases, startupStyle } from '../common/startup';

describe('startupPhases', () => {
  it('shows the logo, then fades the images in, and is done once the last one is in', () => {
    const phases = startupPhases({ isSplashShown: true, isMotionReduced: false });
    expect(phases.map((p) => p.phase)).toEqual(['intro', 'reveal', 'done']);
    const reveal = phases[1].at;
    expect(reveal).toBe(STARTUP_TIMING.intro);
    // The images begin to come in as the logo fades out, not after it is gone
    expect(reveal).toBeLessThan(STARTUP_TIMING.introOutDelay + STARTUP_TIMING.introOut);
    expect(reveal).toBeGreaterThanOrEqual(STARTUP_TIMING.introOutDelay);
    // Not done before the image that begins last has faded in
    expect(phases[2].at - reveal).toBe(startupDelay(1e6, 1e6) + STARTUP_TIMING.imageIn);
  });

  it('fades the images in at once without the splash screen', () => {
    expect(startupPhases({ isSplashShown: false, isMotionReduced: false })).toEqual([
      { phase: 'reveal', at: 0 },
      { phase: 'done', at: STARTUP_TIMING.imagesSpread + STARTUP_TIMING.imageIn },
    ]);
  });

  it('shows the gallery at once when less motion is asked for, splash screen or not', () => {
    for (const isSplashShown of [true, false]) {
      expect(startupPhases({ isSplashShown, isMotionReduced: true })).toEqual([
        { phase: 'done', at: 0 },
      ]);
    }
  });
});

describe('startupDelay', () => {
  it('begins at the top left, later across and further down, never later than the spread', () => {
    expect(startupDelay(0, 0)).toBe(0);
    expect(startupDelay(0, 400)).toBeGreaterThan(0);
    expect(startupDelay(400, 0)).toBeGreaterThan(startupDelay(0, 400));
    expect(startupDelay(1e6, 0)).toBe(STARTUP_TIMING.imagesSpread);
  });
});

describe('startupStyle', () => {
  it('hands every time the stylesheet animates to it, in milliseconds', () => {
    expect(startupStyle()).toEqual({
      '--startup-mark-in': '600ms',
      '--startup-name-delay': '450ms',
      '--startup-name-in': '700ms',
      '--startup-intro-out-delay': '1700ms',
      '--startup-intro-out': '500ms',
      '--startup-image-in': '700ms',
    });
  });
});
