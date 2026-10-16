# Workspace videos: plan

Animate what is on a workspace and save it as a video to share on social media. Not started; this is
the plan, and what was measured to choose it (2026-10-16). The bar is that the motion is smooth and
beautiful, on every computer, in the file that is shared.

## How it works for the user

A video is a list of **shots** on a workspace, played one after the other.

- **The frame.** A video has a format: Reels / TikTok / Stories (1080 × 1920), feed (1080 × 1350), square
  (1080 × 1080) or landscape (1920 × 1080). Its frame is drawn on the workspace as a rectangle of that
  shape, like a sheet, and shows what will be in the video.
- **A shot** is the workspace as it is when "Add shot" is pressed: where the frame is (and how large, which
  is the zoom) and where every object is. The user arranges the next moment with the tools there are
  already (drag, Arrange, snap, swap, texts, sheets) and adds the next shot.
- **Between shots everything glides**: the frame pans and zooms (a Ken Burns move), and each object moves,
  grows, shrinks, turns up or fades from where it was to where it is next, as Keynote's Magic Move does.
  Each shot has a duration, a hold (how long it rests before moving on) and an easing.
- **Entrances**: objects that are new in a shot can come in by fading, rising, scaling or sliding, one
  after another (a stagger of, say, 60 ms), so a grid fills in like a wave rather than at once.
- **A timeline** along the bottom of the workspace shows the shots as small pictures with their
  durations: click to go to one, drag to reorder, play to preview. The preview plays in the workspace
  itself.
- **Save as video**: the same kind of dialog as Save as picture (a name of one's own, the format, 30 or 60
  frames a second), then a folder. Progress shows in the bar at the foot of the side panel; the window
  stays usable.

## Why it will be smooth

1. **The video is not recorded off the screen.** Every frame is drawn on its own at its exact time
   (frame 37 of 60 per second is drawn as it is at 0.6167 s), as long as that takes. A slow computer
   takes longer to save; it never drops or repeats a frame. (Recording the screen with `MediaRecorder`
   is real time and stutters whenever drawing does; rejected.)
2. **Movement is computed, not stepped**: positions are eased curves of time (cubic Béziers, and a spring
   for "settle" moves), sampled at the frame's time, so 60 frames a second are 60 different positions.
   Sub-pixel positions are kept; images are drawn with high-quality smoothing.
3. **Images are decoded before, at the size they need.** For each image, the largest it is on screen in
   any shot decides the size it is decoded at, once, in the image workers (`SharpImages`), before the
   first frame. No frame waits for a decode; nothing is drawn from a thumbnail that is too small.
4. **The preview uses only `transform` and `opacity`** (as the screensaver does), on elements that
   already have their pixels, so it plays at the screen's frame rate; what the preview shows and what the
   video holds come from the same timing function.
5. Later, if wanted: **motion blur** by drawing a few moments within each frame and blending them; it
   makes fast moves look filmed rather than digital.

## How it is made

- **Model** (`common/video.ts`, tested): `VideoFormat`, `Shot { frame: Rect; items: positions;
  duration; hold; easing }`, and `stateAt(shots, time)`: where the frame and every object are at a
  time, with entrances and stagger. Pure, so it is tested like the rest of the workspace maths. Shots are
  stored on the workspace row (a new field, so the workspaces database, not the library's).
- **Drawing a frame**: an `OffscreenCanvas` of the output size in a worker; images, texts and sheets
  drawn as the saved picture draws them (`workspacePicture.ts` already composes a workspace into a canvas;
  that code is shared), from the pre-decoded bitmaps.
- **Encoding**: WebCodecs `VideoEncoder`, measured in this Electron (Chromium 106) in a hidden window:
  - H.264 **baseline** profile (`avc1.42002a`) at 1080 × 1920 and 1920 × 1080, 30 and 60 fps:
    supported. 120 frames of 1080 × 1920 encoded in 1.45 s (about 80 frames a second, software).
  - H.264 main and high profiles: not supported in this build. Baseline plays everywhere and Instagram
    and TikTok re-encode anyway; at 16 Mbit/s it is clean.
  - VP9 and AV1: supported (VP9 120 frames in 1.1 s), for a WebM if wanted.
  - `MediaRecorder` to MP4: not supported (and not wanted, see above).
- **The file**: the encoded frames are put in an MP4 container by
  [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT, plain JavaScript, no binaries). A new
  dependency: to be agreed first. The alternative is bundling ffmpeg (about 80 MB, also GPL-compatible),
  only needed if a profile WebCodecs lacks becomes necessary.
- **Saving**: `writeNewFile`, never over another file; the name from the dialog (`fileNameOf`).
- **Expected speed**: drawing a frame of some 50 images at 1080 × 1920 is a few milliseconds, encoding
  about 12 ms; a 30-second video at 60 frames a second (1,800 frames) should take about half a minute to
  save. To be measured with real photos.

## Steps

1. **Formats and the frame** on the workspace, and the `Shot` model with `stateAt` and its tests.
2. **The timeline and preview**: add, select, reorder and time shots; play and scrub in the workspace.
3. **Frame drawing** in a worker from pre-decoded images, checked frame by frame against `stateAt`.
4. **Encoding and saving** (needs the decision on mp4-muxer), with progress and cancel.
5. **Entrances and stagger**, easing presets (smooth, gentle, snappy, spring), a held last frame, and a
   loop option for Reels.
6. **Polish**: motion blur, a video of the selected sheet only, and an audio track if ever wanted (the
   social apps add music themselves, so not at first).

## Open questions for the user

- The mp4-muxer dependency (step 4), or ffmpeg.
- 60 frames a second by default, or 30 (smaller files; Instagram plays 30).
- Upgrading Electron later would bring hardware H.264 (main/high profile) and faster encoding; not needed
  for this.
