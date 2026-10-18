<img alt="Atlas" src="./resources/logo/atlas/atlas-about-dark.jpg" width="250" />

# Atlas

A desktop app for browsing, tagging and arranging your photo library. It only reads your folders and
never changes your files.

![The gallery with tags, sources and collections in the side panel](./resources/images/readme/gallery.png)

Atlas is a fork of [Allusion](https://github.com/allusion-app/Allusion) by the
[Allusion team](https://allusion-app.github.io/), under the same licence (GPL-3.0).

## Features

**Library**
- **Read-only**: never edits, moves or deletes your photos.
- **Sources**: the folders Atlas watches, with image and tagged counts.
- **Tags**: nest, colour, merge and rename them on one page.
- **Collections**: named groups of tags, opened as one view.
- **Tag inspector**: right-click a tag to see its images, folders and paths.
- **Home gallery**: images tagged `Home` show at start-up.
- **Fast**: thumbnails made in the background; large libraries scroll smoothly.

**Viewing**
- **Three layouts**: rows, columns or a grid, with adjustable size.
- **Collage mode**: put any view in your own order by dragging.
- **Shuffle**, twelve colour themes, and a hideable toolbar.
- **Screensaver**: a moving wall of chosen tags on every monitor.

**Workspaces**
- **Endless canvases** in tabs; drop in tags, folders or images.
- **Arrange** in rows, columns or a grid, cut to 1:1 or 4:5, filled to the edges.
- **Crop**, resize, snap, swap and add text or paper sheets.
- **Layers** with named, lockable groups.
- **Save as a picture** at full resolution.

**Files**
- **Export** chosen or tagged images to a folder.
- **Folder creator** for numbered or dated folders.
- **Import from Allusion**: tags, saved searches and sources carry over.

![A workspace with a grid of images on a white sheet and the layers panel](./resources/images/readme/workspace.png)

More screenshots: [collection](./resources/images/readme/collection.png),
[collage](./resources/images/readme/collage.png),
[tags and collections](./resources/images/readme/tags-and-collections.png). The pictures are generated,
not photographs.

## Install (beta)

Download the file for your computer from the newest release on the
[Releases page](https://github.com/mibrzozek/Atlas/releases). The installers are not signed yet, so the
first launch shows a warning; the steps below get past it.

**Which file?**

| Your computer | Download |
|---|---|
| Windows 10 / 11 | `Atlas-Setup-1.0.0-beta.1.exe` |
| Windows, without installing | `Atlas-Portable-1.0.0-beta.1.exe` |
| Mac with Apple silicon (M1, M2, M3, M4) | `Atlas-1.0.0-beta.1-arm64.dmg` |
| Mac with an Intel processor | `Atlas-1.0.0-beta.1-x64.dmg` |
| Linux: Ubuntu, Debian, Mint | `Atlas-1.0.0-beta.1-amd64.deb` |
| Linux: any other | `Atlas-1.0.0-beta.1-x86_64.AppImage` |

Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" is Apple silicon,
"Processor: Intel" is Intel. The other files in the release (`.yml`, `.blockmap`, `.zip`) are for
automatic updates; you do not need them.

**Windows 10 / 11**
1. Download `Atlas-Setup-1.0.0-beta.1.exe` and open it.
2. At *"Windows protected your PC"*, click **More info → Run anyway**.
3. Choose **Only for me** and click **Install**.

No install wanted? Run `Atlas-Portable-1.0.0-beta.1.exe` from any folder.

**macOS 12+**
1. Download the `.dmg` for your Mac (see the table above).
2. Drag **Atlas** into **Applications** and open it.
3. If it says *"damaged"*, run this in Terminal, then open it again:
   ```
   xattr -cr /Applications/Atlas.app
   ```
   If it says *"cannot be opened"*, go to **System Settings → Privacy & Security → Open Anyway**.

**Linux**
- Ubuntu / Debian: in the download folder, run
  `sudo apt install ./Atlas-1.0.0-beta.1-amd64.deb`
- Other: `chmod +x Atlas-*.AppImage`, then run it. On Ubuntu 22.04+ you may need `sudo apt install libfuse2`.

**Then**
- Add your photo folders with the **+** next to **Sources**.
- Your library is stored apart from your photos (`%APPDATA%\Atlas`, `~/Library/Application Support/Atlas`
  or `~/.config/Atlas`) and is kept when you uninstall.
- Atlas checks for new betas at start-up. The 1.0.0 release will need one manual download.

## Coming from Allusion

In Allusion, make a backup (**Settings → Import/Export**), then restore it in Atlas in the same place.

## Known limits

- Camera raw files (CR2, CR3) are not shown yet.
- Built on Electron 21, which no longer gets security updates: open only your own files.

## Run from source

Needs [Node.js](https://nodejs.org/en/download/) 20 and [Yarn](https://classic.yarnpkg.com/) 1.

```
git clone https://github.com/mibrzozek/Atlas.git
cd Atlas
yarn install
yarn dev     # build and rebuild on change
yarn start   # in a second terminal
```

`yarn test` runs the tests, `yarn package` builds an installer into `/dist`. [`CLAUDE.md`](./CLAUDE.md) is
the guide to the code.

## Licence

GPL-3.0, like Allusion. See [`LICENSE`](./LICENSE).
