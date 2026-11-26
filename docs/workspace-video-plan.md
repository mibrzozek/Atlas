# Workspace videos: plan

> **Revised 2026-10-21:** shots were replaced by lanes (camera, layout, motion, music) on one timeline,
> the beat driving the edit. "Status" at the end describes the editor as it is; the sections in between
> are the first plan, kept for the reasoning behind it (smoothness, encoding, measurements), which holds.

Animate what is on a workspace and save it as a video to share on social media, with music and video
clips. Agreed with the user on 2026-10-20; the libraries mp4-muxer and mp4box.js are approved. The bar is
that the motion is smooth and beautiful, on every computer, in the file that is shared.

## How it works for the user

**Video mode.** A button in the workspace's tool bar turns it on. The video frame shows on the workspace
and a panel opens along the bottom. Turning it off hides both; nothing is lost.

**The frame** is a rectangle on the workspace in the video's shape, like a sheet: what is inside it is what
the video shows. Moving or sizing it is the camera (sizing it is the zoom).

**The bottom panel** (its height can be dragged):
- **the timeline** across the top, always there: play/pause, the time, a playhead, and lanes for shots,
  objects (their keyframes), clips and audio. Ctrl + wheel zooms it.
- **tabs** underneath:
  - **Video**: the format (9:16 Reels/TikTok/Stories, 4:5 feed, 1:1, 16:9, or a custom width × height),
    the frame rate (30, default, or 60), the background colour, loop.
  - **Animation**: for the selected object its keyframes, easing, entrance, delay and stagger.
  - **Audio**: music tracks: where each starts, trim, fade in and out, volume; later beat markers.
  - **Clips**: the video clips in the project: trim, speed, volume.
  - **Export**: a name, then Save video (as Save as picture: a folder, never over another file).

**Shots** are the quick way. A shot is the workspace as it is when "Add shot" is pressed: where the frame
is and where every object is. Arrange the next moment with the tools there are (drag, Arrange, crop,
swap, texts, sheets) and add the next shot. Between shots everything glides: the frame pans and zooms,
objects move, grow, shrink and get cropped from where they were to where they are next; what is new
fades in, what is gone fades out. Each shot has a duration (of the move into it), a hold and an easing
(smooth, gentle, snappy, spring). Clicking a shot in the timeline shows that moment on the workspace;
changing anything then changes that shot. Shots are dragged to reorder, their edges to time them.

**Keyframes and drawn paths** are the precise way, per object, on top of shots. Select an object, move the
playhead, change it (move, size, turn, fade, crop): a keyframe appears in its lane, and the object is
animated between its keyframes. Holding a key while dragging an object records its route as a smooth
path, at the speed it was drawn or stretched to a length; the path shows dotted and can be reshaped. An
object follows its own keyframes where it has them, the shots elsewhere.

**Entrances**: objects new in a shot come in by fading, rising, scaling or sliding, one after another
(a stagger), so a grid fills in like a wave.

**Music**: audio files (mp3, m4a, wav, ogg, flac) in lanes under the shots, as waveforms: slid to where
they start, trimmed, faded, set louder or softer. Several can overlap. Later: fit the video to the song,
and beat markers that shots snap to.

**Video clips**: dropped onto the workspace or the timeline in video mode. A clip is an object like an
image (moved, sized, cropped, animated) with a bar in the timeline for when it plays (slid, trimmed), and
its sound as an audio track. Clips belong to the video, not to the library.

## Why it will be smooth

1. **The video is not recorded off the screen.** Every frame is drawn on its own at its exact time
   (frame 37 of 60 per second is drawn as it is at 0.6167 s), as long as that takes. A slow computer
   takes longer to save; it never drops or repeats a frame.
2. **Movement is computed, not stepped**: positions are eased curves of time, sampled at the frame's
   time. Sub-pixel positions are kept; images are drawn with high-quality smoothing.
3. **Images are decoded before, at the size they need**, once, before the first frame.
4. **The preview uses only `transform` and `opacity`** on elements that already have their pixels, and
   what the preview shows and what the video holds come from the same function of time (`stateAt`).
5. Clip frames are decoded for the exact time of each video frame (WebCodecs `VideoDecoder`).
6. Music is mixed exactly to the video's length, off screen (`OfflineAudioContext`).

## Measured in this Electron (21, Chromium 106)

- Video encoding (`VideoEncoder`): H.264 baseline (`avc1.42002a`) at 1080 × 1920 and 1920 × 1080, 30 and
  60 fps; 120 frames of 1080 × 1920 in 1.45 s (about 80 a second). Main and high profiles: not supported.
  VP9 and AV1: supported.
- Audio encoding (`AudioEncoder`, 2026-10-20): AAC (`mp4a.40.2`) and Opus reported supported (not yet
  encoded for real: the first thing to check in step 4).
- Decoding for clips and music: H.264 up to 4K, VP9, AV1; AAC, Opus, MP3. **HEVC / H.265 (the iPhone's
  default) is not supported**: an Electron upgrade brings it (the system's decoder), or iPhones set to
  "Most Compatible"; ffmpeg is the fallback.
- WebCodecs only exists on a secure page: the app's file page is one, `about:blank` is not.

## How it is made

- **Model** (`common/video.ts`, tested): `VideoFormat`, `Shot` (frame, the place of every object,
  duration, hold, easing), keyframes per object, and `stateAt(video, items, time)`: where the frame and
  every object are at a time. Pure. Stored on the workspace row (`video`), in the workspaces database.
- **Frames**: drawn into a canvas of the output size as the saved picture draws a workspace
  (`workspacePicture.ts`), from bitmaps decoded beforehand at the size they need.
- **Encoding**: WebCodecs `VideoEncoder` (H.264) and `AudioEncoder` (AAC), put in an MP4 by
  **mp4-muxer**. Clips are read with **mp4box.js** (MP4 demuxing) and `VideoDecoder`.
- **Saving**: `writeNewFile`, never over another file.

## The full-window player

The ` key shows the video over the whole window, with the timeline under it (never over the picture).
More ways of watching will be added there, so its bar is laid out once, for all of them:

```
┌ deck, 11rem, always this wide ┐┌ timeline (read only, half height) ─────────────────────┐
│ [▶]  0:02.7 / 0:08.0          ││ ruler with beats, the end marker                       │
│ ☐ Loop  ☐ …  ☐ …              ││ Camera · Layout · Motion · Music                       │
│ ☐ …     ☐ …                   ││                                                        │
└───────────────────────────────┘└────────────────────────────────────────────────────────┘
                                                          Back to editing (`)  ← top right of the picture
```

- **The deck** (`.workspace-video-deck`) is a column of one width on the left. On top, always where it is:
  play/pause and the time (`.workspace-video-transport`). Under it, rows of small options
  (`.workspace-video-deck-options`), as many rows as the timeline is tall: two, about six options. The
  deck never grows wider and the timeline never moves when an option comes or goes.
- **An option is a small toggle or a short choice** (a checkbox like Loop, or a few joined buttons like the
  `Choices` of the Selected tab, at the deck's smaller size). Nothing in the deck opens a dialog. Anything
  that changes the video itself (its format, its blocks) stays in the panel: the full-window player only
  changes how it is watched.
- **Shared with the panel:** every option that also makes sense while editing is one component used in
  both places (`LoopCheckbox` is the pattern), with its state on `VideoPlayer` (not stored) or on
  `UiStore` (stored) when it should survive a restart.
- **More than fits:** once the two rows are full, the least used go into a "⋯" menu at the end of the last
  row (the app's `MenuButton`), rather than a third row or a wider deck.
- **Shortcuts:** every option has a key, shown in its tooltip, in `hotkeyMap` so it is listed under
  Settings, Shortcuts. The keys of video mode (Space, `, Escape) are written into `WorkspaceView` today:
  they move to `hotkeyMap` first (`videoPlay`, `videoFullWindow`), then each option gets its own.
- **Idle:** while playing with the mouse at rest only the pointer and "Back to editing" fade; the deck
  and the timeline stay, so the time can always be read.

Options foreseen, in the order they would come (each a small step of its own):

| Option | Kind | Key (proposed) | State |
|---|---|---|---|
| Loop | checkbox | Shift+L | `player.isLooping` (done) |
| Mute the music | checkbox | M | `player.isMuted` |
| Speed: ½× · 1× · 2× | choices | `[` / `]` | `player.speed` |
| Frame by frame | buttons ◀ ▶ (in the transport, after the time) | , / . | moves the playhead one frame |
| To the start / end | keys only | Home / End | |
| Safe areas (where a platform's buttons and captions cover the picture) | checkbox | S | `UiStore`, stored |
| Beat click (hear the beats found) | checkbox | B | `player.isClicking` |
| Loop between two marks (In/Out on the ruler) | checkbox, with I / O to set them | I, O | `player.loopFrom/To` |

Shift+L for Loop, because L alone locks a workspace.

## Steps

1. **Video mode, the bottom panel, the formats and the frame; shots; preview; saving an MP4**: the first
   working version, without sound.
2. **Music**: the audio lane, trim, fades, volume, AAC in the MP4.
3. **Keyframes and drawn paths** per object.
4. **Video clips** (best after the Electron upgrade, for iPhone videos).
5. **Entrances, stagger, loop, beat markers, motion blur.**

## Status

**2026-10-21: the editor is rebuilt around lanes**, after trying shots: the user found shots and clips
did not fit (this is camera movement over one canvas, not cutting between recordings) and asked for a
timeline of lanes, the beat driving the edit, and a layout that can stay fixed or change.

What works, checked in a hidden copy with real input and a made-up song (clicks at 120 a minute):
- Every camera stop is a shot on the workspace: dotted when not selected; selected, the view glides to
  it, the rest blurred, and it is locked until "Edit shot" (drag to move, corner to size, lined up with
  the shot before it). (Until 2026-10-22 the frame was a viewfinder fixed on the screen.)
- **Camera lane:** stops added beside the one before (+) or framing what is selected; each arrives by
  glide, whip, cut or scroll and stays still, pushes in, pulls out or drifts; ends dragged, blocks
  reordered.
- **Layout lane:** optional arrangements; selecting one puts everything there, and changes go into it.
- **Motion lane:** pop in, drop in, slide in, fade in, jiggle, float, breathe, pulse on the beat, shake,
  spin, pop out, fly out, fade out, on the photos selected, from the playhead, with strength, speed and a
  stagger; moved and stretched by their edges, in rows where they overlap.
- **Music lane:** a song from the computer (read only), its tempo and beats found (120.1 for 120), its
  waveform, the beats marked on the ruler; every dragged edge snaps to them (Alt: not). Volume, where it
  begins, how much of its start is skipped.
- Preview with the music; saving an MP4 with picture and AAC sound (checked: both the same length).
- Default timeline of a minute, the wheel over the panel zooming it; Space plays, Delete removes.
- **2026-11-26 additions:**
  - **Lock shot to layer:** in the Selected tab, each camera stop predicts the majority layer in its frame (`predictedLayerForShot`) and can be locked to that layer (or any other chosen layer). Moving or resizing a locked layer moves and scales its locked shots atomically (`followLockedLayers`), and selecting a locked shot selects its layer in the Layers panel.
  - **Layer visibility (`isHidden`):** hidden layers and groups are omitted from video preview and exported MP4s.
  - **Two-tier phone export:** `Phone (≤ 26 MB)` (720p capped for the Claude phone app), `Phone (Full Reel)` (uncapped 1080p saved straight to Desktop for self-uploading), and `Full`.
  - **Nested continuous zoom-out planner (`common/zoom-chain.ts`):** dev-CLI `zoomChain` command auto-partitions long nested chains into bounded clusters with pixel-identical `(child, host)` relay bridges and seamless infinite loops.

Not yet: effects (light leaks, film burn, grain...: next, as a lane of their own), recording a camera
move live, beat markers in the motion lane (pulse uses them already), the beat finder on real music (only
made-up songs so far), trying it on the real library and screen.
