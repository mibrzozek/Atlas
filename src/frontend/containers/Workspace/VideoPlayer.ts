import { action, makeObservable, observable } from 'mobx';

/**
 * Where the video of a workspace is being watched: the playhead, whether it plays, and whether the preview
 * is shown over the workspace. Shared by the panel along the bottom and the preview; not stored.
 */
export class VideoPlayer {
  /** The playhead, in seconds */
  @observable time = 0;
  @observable isPlaying = false;
  /** Whether the preview is shown over the workspace (while playing, or at the playhead) */
  @observable isShowing = false;
  /** Whether the preview fills the whole window instead (the ` key) */
  @observable isFullscreen = false;
  /** Whether playing starts over from the beginning at the end marker, instead of stopping there */
  @observable isLooping = false;
  /** Counts up every time playing starts over: what plays along (the music) starts over with it */
  @observable loops = 0;

  constructor() {
    makeObservable(this);
  }

  /** Plays from the playhead, or from the start when it is at the end */
  @action.bound play(length: number): void {
    if (this.time >= length - 1e-3) {
      this.time = 0;
    }
    this.isPlaying = true;
    this.isShowing = true;
  }

  @action.bound pause(): void {
    this.isPlaying = false;
  }

  /** The preview at a time, paused */
  @action.bound seek(time: number): void {
    this.time = Math.max(0, time);
    this.isPlaying = false;
    this.isShowing = true;
  }

  /** The playhead put somewhere without showing the preview: at a shot shown on the workspace */
  @action.bound moveTo(time: number): void {
    this.time = Math.max(0, time);
  }

  @action.bound setLooping(isLooping: boolean): void {
    this.isLooping = isLooping;
  }

  /** Time passed while playing; at the end it stops, or starts over when looping */
  @action.bound advance(seconds: number, length: number): void {
    const time = this.time + seconds;
    if (time < length) {
      this.time = time;
    } else if (this.isLooping && length > 0) {
      this.time = time % length;
      this.loops += 1;
    } else {
      this.time = length;
      this.isPlaying = false;
    }
  }

  /** Back to editing on the workspace */
  @action.bound close(): void {
    this.isPlaying = false;
    this.isShowing = false;
    this.isFullscreen = false;
  }

  /** What the camera sees at the playhead over the whole window, or back to the workspace */
  @action.bound toggleFullscreen(): void {
    if (this.isFullscreen) {
      this.close();
    } else {
      this.isShowing = true;
      this.isFullscreen = true;
    }
  }
}
