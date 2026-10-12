import { ImagePool, LaneOrientation, ScreensaverImage, planScreens } from 'common/screensaver';
import { ScreensaverImages } from './images';
import { SHOWCASE_STEP_DURATION, ShowcasePresenter } from './showcase';
import { ScreenSurface, wait } from './tile';
import { WALL_GAP, WALL_STEP_DURATION, WallPresenter } from './wall';

export interface DirectorOptions {
  /** Rows, or columns like the vertical masonry view */
  orientation: LaneOrientation;
  /** How long a screen stands still between two changes */
  secondsPerStep: number;
}

type Presenter = WallPresenter | ShowcasePresenter;

/**
 * Runs the screensaver on all screens together: decides what each of them shows for the number of images
 * there is, hands out the images so that none is on two screens at once, and lets the screens change in
 * turn, never two at the same moment.
 */
export class ScreensaverDirector {
  private readonly pool: ImagePool<ScreensaverImage>;
  private readonly images = new ScreensaverImages();
  private presenters: Presenter[] = [];
  private isDisposed = false;
  /** What every screen was planned to show, for looking at from tests */
  readonly plans: ReturnType<typeof planScreens>;

  constructor(
    private readonly surfaces: readonly ScreenSurface[],
    imageList: readonly ScreensaverImage[],
    private readonly options: DirectorOptions,
  ) {
    this.pool = new ImagePool(imageList);
    const meanAspectRatio =
      imageList.reduce((sum, image) => sum + image.aspectRatio, 0) / Math.max(1, imageList.length);
    this.plans = planScreens(
      surfaces,
      imageList.length,
      meanAspectRatio,
      options.orientation,
      WALL_GAP,
    );
  }

  /** Shows the first images on every screen, and keeps them changing from then on */
  async start(): Promise<void> {
    const { surfaces, pool, images, options } = this;
    this.presenters = this.plans.map((plan, i) =>
      plan.mode === 'wall'
        ? new WallPresenter(surfaces[i], pool, images, {
            orientation: options.orientation,
            laneCount: plan.laneCount,
          })
        : new ShowcasePresenter(surfaces[i], pool, images, plan.groupSize),
    );
    // All at once: the screens light up together. Taking images from the pool happens right away, in
    // order, so they still each get their own
    const firstGroups = this.presenters.map((presenter) =>
      presenter instanceof ShowcasePresenter ? presenter.pick() : [],
    );
    // Fewer images than screens: the screens that got none show what another one shows
    const anyGroup = firstGroups.find((group) => group.length > 0) ?? [];
    await Promise.all(
      this.presenters.map(async (presenter, i) => {
        if (presenter instanceof WallPresenter) {
          return presenter.start();
        }
        const isOwn = firstGroups[i].length > 0;
        const isShown = await presenter.present(isOwn ? firstGroups[i] : anyGroup, !isOwn);
        if (!isShown && isOwn) {
          // None of its first images could be drawn: on to the next ones
          await presenter.step();
        }
      }),
    );
    if (this.isDisposed) {
      return;
    }
    this.run().catch((e) => console.error('The screensaver stopped changing', e));
  }

  private get showcases(): ShowcasePresenter[] {
    return this.presenters.filter((p): p is ShowcasePresenter => p instanceof ShowcasePresenter);
  }

  private async run(): Promise<void> {
    const { win } = this.surfaces[0];
    const isWall = this.presenters[0] instanceof WallPresenter;
    const stepDuration = isWall ? WALL_STEP_DURATION : SHOWCASE_STEP_DURATION;
    // A screen is never changed again before it has stood still for a moment. Large images are there to
    // be looked at: a showcase changes half as often as a wall moves, and stands still for a good while
    const period = isWall
      ? Math.max(this.options.secondsPerStep * 1000, stepDuration + 800)
      : Math.max(this.options.secondsPerStep * 1500, stepDuration + 6000);
    // The screens take turns, evenly spread
    const tick = period / this.presenters.length;
    let nextAt = win.performance.now() + period;
    let lastRotation = win.performance.now();
    for (let turn = 0; !this.isDisposed; turn++) {
      await wait(win, Math.max(0, nextAt - win.performance.now()));
      if (this.isDisposed) {
        return;
      }
      nextAt = Math.max(nextAt + tick, win.performance.now() + 200);
      const presenter = this.presenters[turn % this.presenters.length];
      try {
        if (presenter instanceof WallPresenter) {
          await presenter.step();
        } else if (!(await presenter.step())) {
          // Every image is on a screen. Then the screens pass their images on to each other
          if (win.performance.now() - lastRotation >= period - 50) {
            await this.rotate();
            lastRotation = win.performance.now();
          }
        }
      } catch (e) {
        console.error('Screensaver: could not change the screen', e);
      }
    }
  }

  /** Every showcase takes over the images of the next one, all at the same time */
  private async rotate(): Promise<void> {
    const showcases = this.showcases;
    const groups = showcases.map((showcase) => showcase.shown);
    const isAllTheSame = groups.every(
      (group) => group.map((i) => i.id).join() === groups[0].map((i) => i.id).join(),
    );
    if (showcases.length < 2 || isAllTheSame) {
      return;
    }
    await Promise.all(
      showcases.map((showcase, i) => showcase.present(groups[(i + 1) % groups.length], true)),
    );
  }

  dispose(): void {
    this.isDisposed = true;
    this.presenters.forEach((presenter) => presenter.dispose());
    this.presenters = [];
    this.images.dispose();
  }
}
