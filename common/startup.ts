/**
 * How Atlas comes into view when it starts: the home gallery is laid out and drawn unseen, the logo and the
 * name come and go (when the splash screen is on), then the images fade in from the top left. The one home
 * of its timing: the store steps through `startupPhases`, the stylesheet reads `startupStyle` (`startup.scss`),
 * each image takes `startupDelay`.
 */

export type StartupPhase = 'waiting' | 'intro' | 'reveal' | 'done';

/** In milliseconds */
export const STARTUP_TIMING = {
  /** The logo fades in */
  markIn: 600,
  /** The name fades in, beginning a little after the logo */
  nameDelay: 450,
  nameIn: 700,
  /** Both fade out together, as the images begin to come in */
  introOutDelay: 1700,
  introOut: 500,
  /** How long the logo is seen before the images begin to fade in */
  intro: 1900,
  /** One image fades in */
  imageIn: 700,
  /** The last image begins this much later than the first */
  imagesSpread: 900,
};

/** The phases the start goes through after the gallery is drawn, each with when it begins */
export function startupPhases(options: {
  isSplashShown: boolean;
  isMotionReduced: boolean;
}): { phase: StartupPhase; at: number }[] {
  // Asked for less motion: the gallery is there at once
  if (options.isMotionReduced) {
    return [{ phase: 'done', at: 0 }];
  }
  const { intro, imageIn, imagesSpread } = STARTUP_TIMING;
  const revealAt = options.isSplashShown ? intro : 0;
  return [
    ...(options.isSplashShown ? [{ phase: 'intro' as const, at: 0 }] : []),
    { phase: 'reveal', at: revealAt },
    { phase: 'done', at: revealAt + imagesSpread + imageIn },
  ];
}

/** How much later than the first an image at this place begins to fade in: from the top left, across and down */
export function startupDelay(top: number, left: number): number {
  return Math.min(STARTUP_TIMING.imagesSpread, Math.round(top * 0.4 + left * 0.15));
}

/** The timing as the stylesheet reads it */
export function startupStyle(): Record<string, string> {
  const ms = (value: number) => `${value}ms`;
  const t = STARTUP_TIMING;
  return {
    '--startup-mark-in': ms(t.markIn),
    '--startup-name-delay': ms(t.nameDelay),
    '--startup-name-in': ms(t.nameIn),
    '--startup-intro-out-delay': ms(t.introOutDelay),
    '--startup-intro-out': ms(t.introOut),
    '--startup-image-in': ms(t.imageIn),
  };
}
