<img alt="Atlas" src="./resources/logo/atlas/atlas-about-dark.jpg" width="250" />

# Atlas

Atlas is a desktop app for browsing, tagging and arranging a library of photographs, digital and film.
It reads your image folders and never changes them: tags, collections and orderings live in Atlas's own
database, next to your files rather than inside them.

![The gallery: a wall of images with their tags, and sources, collections and tags in the side panel](./resources/images/readme/gallery.png)

Atlas is a personal fork of [Allusion](https://github.com/allusion-app/Allusion) 1.0.0-rc.10, the visual
library manager made by the [Allusion team](https://allusion-app.github.io/). Everything Atlas does is built
on their work, and it is released under the same licence, GPL-3.0.

## What Atlas adds to Allusion

**It leaves your files alone**

- Writing metadata into files, moving files to the trash and moving files between folders are switched
  off. The only thing Atlas can create inside a folder of yours is a new, empty folder, and only when you
  ask for one.

**Faster with large libraries**

- Thumbnails for the whole library are made in the background, so scrolling does not wait for them.
- Large tiles are drawn at exactly the size they are shown, instead of loading the full original.
- Start-up no longer waits for ExifTool; TIFF files open without freezing the window.
- Photos taken with the camera turned sideways are laid out with their real shape.

**Organising**

- **Sources**: the folders Atlas watches (called Locations in Allusion), with a count of images and of
  tagged images for the folder that is open.
- **Collections**: named groups of tags. Opening one shows the images of all its tags.
- **Tags and Collections page**: one place to rename, colour, nest, merge and delete tags and to build
  collections. Tag colours can follow the theme.
- **Home gallery**: the images tagged `Home`, shown when Atlas starts.
- **Workspaces**: endless canvases, one per tab, made from what the Library shows and laid out the same
  way, or filled by dragging tags, collections, folders and images onto them. Move, stack and size
  images, add texts and paper sheets, snap to edges, middles and even gaps, arrange a selection in rows,
  columns or a grid (whole or cut to 1:1 or 4:5, or filled out to the edges), crop images by hand, size
  several at once, copy between workspaces, reorder layers and gather them in named groups, and save as
  a picture at the full resolution of the photos. Zoom from thousands of images at a glance to one at
  full size.
- **Tag inspector**: right-click a tag and choose Inspect to see how many images it holds, from which
  folders, and every image with its path and a large preview on hover.
- **Collage mode**: put the images of any view in your own order by dragging them, or switch two.
- **Export**: copy selected or tagged images to a folder you pick.
- **Folder creator**: make a run of numbered or dated folders, continuing the numbering already there.

**Looking**

- **Screensaver**: after the computer has been idle, a moving wall of the images of the tags and
  collections you choose, on every monitor.
- Twelve colour themes, a shuffle button, and a bar that can be hidden to give the images more room.

## A look around

A collection open in the horizontal masonry view:

![A collection of four tags, shown as justified rows](./resources/images/readme/collection.png)

Collage mode, where every image has a slot of its own and can be dragged to another place:

![Collage mode: images whole inside equal slots](./resources/images/readme/collage.png)

A workspace: a grid cut to 4:5 on a sheet of paper, a second batch beside it, and the layers on the right:

![A workspace with a grid of images on a white sheet, a batch in rows next to it, and the layers panel](./resources/images/readme/workspace.png)

The page for editing tags and collections:

![Tags and Collections: collections as chips on the left, the tree of tags on the right](./resources/images/readme/tags-and-collections.png)

The pictures in these screenshots are generated, not photographs.

## Installing the beta

Atlas is in beta: it works and is used daily, but expect rough edges. The installers are on the
[Releases page](https://github.com/mibrzozek/Atlas/releases), marked *Pre-release*. Open the newest one
(for example **Atlas 1.0.0-beta.1**) and download the file for your computer from its **Assets** list.

The installers are not signed with a paid developer certificate yet, so Windows and macOS warn about
them the first time. The steps below get past that once; after that Atlas opens like any other app.

### Windows 10 and 11

1. Download `Atlas-Setup-1.0.0-beta.1.exe`. If your browser warns that the file is not commonly
   downloaded, keep it (in Edge: **…** next to the download → **Keep**, then **Keep anyway**).
2. Open it. If Windows says *"Windows protected your PC"*, click **More info**, then **Run anyway**.
3. Accept the licence with **I Agree**, choose **Only for me** (this needs no administrator rights),
   keep the suggested folder and click **Install**.
4. Start Atlas from the Start menu or the desktop shortcut.

Rather not install anything? Download `Atlas-Portable-1.0.0-beta.1.exe` instead and run it from any
folder or a USB stick. It tells you when there is a new version, but you download that yourself.

### macOS 12 or newer

1. Download the `.dmg` for your Mac: `arm64` for Apple silicon (M1 and later), `x64` for Intel. (Apple
   menu → About This Mac shows which: "Chip: Apple M…" or "Processor: Intel".)
2. Open the `.dmg` and drag **Atlas** into **Applications**.
3. Open Atlas from Applications. The first time, macOS refuses it, in one of two ways:
   - *"Atlas is damaged and can't be opened"* (most likely on Apple silicon Macs): it is not damaged,
     it is only not signed. Click **Cancel**, open **Terminal** (in Applications → Utilities), paste the
     line below, press Return, and open Atlas again:

     ```
     xattr -cr /Applications/Atlas.app
     ```

   - *"cannot be opened"* or *"Apple could not verify…"*: click **Done** or **OK**, open
     **System Settings → Privacy & Security**, scroll down to the message about Atlas, click
     **Open Anyway** and then **Open**.

### Linux

- **Ubuntu, Debian, Mint and the like**: download `Atlas-1.0.0-beta.1-amd64.deb`, open a terminal in
  the folder it was saved to (usually `cd ~/Downloads`) and install it with the line below. The `./`
  matters: without it apt looks for a package of that name online. Atlas is then in your applications
  menu.

  ```
  sudo apt install ./Atlas-1.0.0-beta.1-amd64.deb
  ```

- **Any other distribution**: download `Atlas-1.0.0-beta.1-x86_64.AppImage`, make it runnable with
  `chmod +x Atlas-*.AppImage` (or in the file's Properties, *Allow executing as a program*), and
  double-click it. If nothing happens on Ubuntu 22.04 or newer, install FUSE 2 first:
  `sudo apt install libfuse2` (`libfuse2t64` on 24.04).

### After installing

1. Atlas starts with a welcome page and an empty library. Add your photo folders with the **+** (New
   Source) in the header of **Sources** in the side panel. Atlas only reads them; it never changes,
   moves or deletes a file there. Thumbnails are made in the background, with the progress at the
   bottom left.
2. Coming from Allusion? See [below](#coming-from-allusion) to bring your tags along.
3. At start-up Atlas looks for a newer beta (this can be switched off under Settings). The Windows
   installer version and the AppImage update themselves when you agree; the portable Windows file and
   the Mac version tell you and open the releases page, and the `.deb` is updated by installing the
   new one the same way. When the official 1.0.0 is out, download it once by hand: a beta only looks
   for newer betas.
4. Your library is kept apart from your photos and from Allusion: in `%APPDATA%\Atlas` on Windows,
   `~/Library/Application Support/Atlas` on macOS, `~/.config/Atlas` on Linux. Uninstalling Atlas
   leaves it there.

To uninstall: Windows, **Settings → Apps → Atlas → Uninstall**; macOS, drag Atlas from Applications to
the Trash; Linux, `sudo apt remove atlas` or delete the AppImage.

## Running it from source

You need [Node.js](https://nodejs.org/en/download/) 20 and [Yarn](https://classic.yarnpkg.com/) 1.

```
git clone https://github.com/mibrzozek/Atlas.git
cd Atlas
yarn install
yarn dev        # builds into /build and keeps rebuilding on every change
yarn start      # in a second terminal: starts Atlas
```

Reload the window (Ctrl/Cmd + R) after a change. Changes to `src/main.ts` need a restart.

| Command | What it does |
|---|---|
| `yarn dev` | Watch build |
| `yarn start` | Start Atlas |
| `yarn oobe` | Start Atlas as a new user, with an empty throwaway profile |
| `yarn test` | Run the tests |
| `yarn package` | Build an installer for your platform into `/dist` |

Atlas is developed and tested on Windows. The Mac and Linux support inherited from Allusion is still in
the code, but nobody has run this fork there.

## Coming from Allusion

Atlas can read an Allusion library: in Allusion, make a backup under Settings → Import/Export, then
restore that file in Atlas under the same menu. Tags, saved searches and locations come along. A backup
made in Atlas can be restored into Allusion too; collections then show up there as saved searches.

## Things to know

- Camera raw files (CR2, CR3 and the like) are not shown yet.
- The installers are not signed yet; see [Installing the beta](#installing-the-beta) for the warnings
  that causes and how to get past them.
- Atlas runs on Electron 21, which no longer receives security updates. It only opens your own local
  files; do not point it at untrusted content.

## Working on the code

[`CLAUDE.md`](./CLAUDE.md) is the working guide: the rules (the image files are never touched), how the
code is laid out, how changes are verified, and what is easy to break.

## Licence and credit

GPL-3.0, like Allusion. See [`LICENSE`](./LICENSE).

Allusion is the work of the Allusion team: <https://github.com/allusion-app/Allusion>.
