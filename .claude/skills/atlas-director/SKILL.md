---
name: atlas-director
description: Direct a photo film (a reel, short, loop or video) in Atlas with taste - cast the photos, write a treatment against the song, place every shot by hand, then review the real frames like an editor. Use whenever the owner asks to make, remake, fix or judge a video from their photos in Atlas, or says a video lacks taste, direction or care.
---

# Atlas director

The auto-edit (`edit <id> mixed|cuts|flow <seed>`) is a sketch, never the film. The owner judged two
auto-edited reels as "technically proficient, missing taste, direction, attention to what is in frame,
mistakes where the panning and zooming happen, and lack of touch". This skill exists to stop that.

Read before starting: [craft.md](references/craft.md) (how shots, moves and cuts work),
[taste.md](references/taste.md) (the owner's own rules, which win over craft.md), and
[checklist.md](references/checklist.md) (the review). The Director commands are listed at the top of
`scripts/dev/atlas.js`; the rules for driving Atlas are in CLAUDE.md ("The Director").

Ask which song every time (CLAUDE.md). Everything below happens after the song is chosen.

## 1. Cast (look at every photo)

1. `create` the workspace, `video <id> 9:16`, `music <id> <song>`.
2. `contact <id> {"width": 360}` (page with `"from"`) and look at every photo, not thumbnails of a grid.
3. Write a casting sheet in the scratchpad, one line per photo:
   `7 | HERO | lowrider mid-hop, wheels off the ground, sharp | subject 0.55,0.62 | moves right`
   Grades: **HERO** (would stop a thumb), **SUPPORT** (good, adds place or rhythm), **CUT** (soft, dark
   without intent, duplicate, cluttered, a stranger's face as the subject). Expect a third or more CUT.
   A blurry or near-black photo is never a hero unless the blur is the point.
4. `subject <id> <photo> <x> <y>` for every HERO and SUPPORT: where the eye goes (a face's eyes, the
   car's grille, the sign). Check the rings on `photos <id>`.

## 2. Treatment (before touching a shot)

Write it in the scratchpad, short:

- **Idea**, one sentence that is not the tag: not "Halloween photos" but "the city after dark,
  where everyone is someone else".
- **The song's shape**: `soundPicture <id> 0 <length+20>`. Mark the intro, the drop, each swell, the
  quiet. Choose the 30 to 45 s window with `setMusic {"trim"}` so it has a beginning, a lift and an end.
- **Arc**, mapped to song times:
  - **Hook (0 to 1.5 s)**: the strongest HERO, mid-action, already moving. Never a title, never a
    wide grid, never a dark or soft photo.
  - **Set-up**: place and mood, SUPPORT photos, slower.
  - **Build**: shorter shots, closer framing, toward the drop.
  - **Drop/peak**: the two or three best HEROes, held. The layout reveal (all photos) belongs here
    or at the end, once.
  - **Release and last frame**: slow down, end on an image that answers the hook (same subject, the
    calm after, or the title over a hero). The last frame is what a loop returns to.
- **Shot list**: a numbered table: time, length, photo, framing (subject, tight or loose), move
  (push-in, pull-out, pan direction and why), arrival (cut, glide, whip), beat it lands on.
  Lengths vary on purpose: long-short-short-long, never all 0.9 s. HEROes get at least two beats.
- **Title**: does this film need one? If yes, where it lands and how long (at least 1.5 s readable).

## 3. Build by hand

Start from a clean timeline, not an auto-edit to patch: run `edit` once only if a scaffold of the
right length helps, then rebuild every shot with `setShot`/`addShot`/`remove`/`move`.

- Frame with `{"photo": n}` (it centres on the subject once one is set), `zoom`, `move`; `room` when a
  photo must be seen whole.
- Motions (`addMotion`, `waves`) serve a moment in the treatment; remove any you cannot justify.
- Arrange the layout (`arrange`, `path`, `shuffle`) for the shots that show it, and make sure at least
  one shot does show it if the layout was the idea (a promised spiral that is never seen is a lie).

## 4. Review like an editor

1. `timeline <id>`: fix every entry of `warnings` or write down why it stays.
2. `cuts <id> {"width": 360}`: both sides of every cut, first and last frame.
3. `picture <id> <times> {"width": 540}` across every move: start, middle, end of each push, pan and
   whip, and the title's whole stay.
4. Go through [checklist.md](references/checklist.md) item by item against those pictures. Every
   failure is fixed and re-pictured, not explained away ("it is mid-move" is a finding, not an excuse).
5. Fresh eyes: give a subagent only the pictures, the treatment, checklist.md and taste.md (not your
   reasoning) and ask it for the five weakest moments. Fix what holds up.
6. Only then `save <id> full|phone`, and say what was not checked (the saved file itself is not played).

## 5. Learn

When the owner sends a video back, add each point to [taste.md](references/taste.md) as a rule with
the example that taught it, in their words where possible. Rules there override craft.md. Never delete
a rule without asking.
