# Installers for Windows, macOS and Linux: plan

Goal: anyone can download Atlas from one page, install it in a minute on Windows, a Mac or Linux, open it
without frightening warnings, and get updates without doing anything. Written 2026-10-16; nothing here
is built yet.

## Where we start

Most of the machinery is already there, inherited from Allusion:

| Piece | State |
|---|---|
| **electron-builder 23** in `package.json` (`yarn package`) | configured: Windows NSIS installer + portable `.exe`, macOS `.dmg`, Linux `.AppImage`; ExifTool bundled per platform (`exiftool.exe` on Windows, the Perl version on macOS/Linux) |
| **GitHub Actions** `.github/workflows/release.yml` | builds all three when a tag `v*` is pushed, and uploads to a GitHub Release. Old: Node 16, `actions/*@v1`, a third-party action. Needs updating; not yet run on this fork |
| **Auto-update** (`electron-updater`) | built in, asks before downloading. Reads the GitHub releases of the repository in `package.json`, which is already `mibrzozek/Atlas`. But the "Open release page" button and the crash report link still point at Allusion |
| **Data folder** | an installed Atlas keeps its library in its own folder (`%APPDATA%\Atlas`, `~/Library/Application Support/Atlas`, `~/.config/Atlas`), apart from Allusion and from the development copy (`%APPDATA%\Electron`) |
| **Version** | still Allusion's `1.0.0-rc.10`; the repository also holds Allusion's old tags (`v1.0.0-rc9`...) |
| **Icons** | `.ico` and `.icns` exist; Linux needs a set of PNGs wired in |

## What a user will get

| | Download | Installs to | Updates |
|---|---|---|---|
| **Windows 10/11** | `Atlas-Setup-1.0.0.exe` (installer, per user, no admin rights needed) and `Atlas-Portable-1.0.0.exe` (runs from anywhere, e.g. a USB stick) | `%LOCALAPPDATA%\Programs\Atlas`, Start menu and desktop shortcut | automatic (installer version) |
| **macOS 12+** | `Atlas-1.0.0-arm64.dmg` (Apple Silicon) and `Atlas-1.0.0-x64.dmg` (Intel); drag to Applications | `/Applications/Atlas.app` | automatic, **only if the app is signed** (see below) |
| **Linux** | `Atlas-1.0.0.AppImage` (any distribution, one file) and `atlas_1.0.0_amd64.deb` (Ubuntu, Debian, Mint) | AppImage: anywhere; deb: system | AppImage automatic; deb by downloading the new one |

Sizes: about 90-130 MB each (Electron itself is most of it).

## The decisions to make first

1. **The version number.** Proposal: **Atlas 1.0.0**, tag `v1.0.0`. It sorts after Allusion's
   `1.0.0-rc.10`, so nothing is confused, and it says "first real release of Atlas".
2. **Code signing: what to pay for.** Without it, the operating systems warn people away:
   - **Windows**, unsigned: SmartScreen shows "Windows protected your PC"; people must click *More info,
     Run anyway*. It works, but many give up. Options: **Azure Trusted Signing** (about $10 a month,
     identity check, the cheapest real certificate; available to individuals in the US and Canada) or
     an OV certificate from a vendor (about $200-400 a year, on a USB token or cloud HSM). Reputation
     builds up per certificate either way.
   - **macOS**, unsigned: on macOS 15 (Sequoia) an unsigned downloaded app is blocked; people must go to
     *System Settings, Privacy & Security, Open Anyway*. Auto-update does not work at all unsigned.
     Fix: the **Apple Developer Program, $99 a year**, then electron-builder signs and notarizes in CI.
     Strongly recommended if Mac users matter.
   - **Linux**: no signing needed.

   Proposal: release 1.0.0 unsigned on Windows (with a clear note on the download page), signed and
   notarized on macOS. Add Windows signing when there are users.
3. **Electron 21 before or after the first release.** Electron 21 gets no security fixes, and the window
   runs with Node integration on. Atlas loads no web content, so the risk is small, but it is the first
   thing a reviewer of a public release would flag, and newer macOS/Linux versions may break it. Proposal:
   ship 1.0.0 on Electron 21 to get installers into people's hands, then make the Electron upgrade (with
   context isolation) the next big step.
4. **Do you have a Mac to test on?** CI can build the Mac version without one, but someone has to open it
   once on a real Mac before it goes out. Same for a Linux machine or VM.

## Steps

### 1. Make it Atlas everywhere (small, here)
- `version` to `1.0.0`; `author` to you; `appId` stays `com.atlas-app.atlas`.
- Point the update dialog's release page (`src/main.ts`), the crash report link (`githubUrl` in
  `common/config.ts`) and `dev-app-update.yml` at `mibrzozek/Atlas`. Without this, people would be sent
  to Allusion's releases.
- Explicit `publish` block (`provider: github, owner: mibrzozek, repo: Atlas, releaseType: draft`), so
  every release starts as a draft to check before it is public.
- Linux icons (`resources/logo/atlas/png`), `.deb` target, the GPL licence shown in the Windows installer,
  file names without spaces (`artifactName`).
- The uninstaller keeps the user's data (electron-builder's default, `deleteAppDataOnUninstall: false`):
  keep it so. It never touches photos in any case; Atlas never writes there.

### 2. Build it locally once (here, needs your OK)
`yarn package` on Windows makes the Windows installer and portable. It downloads electron-builder's tools
(NSIS, about 50 MB) into `%LOCALAPPDATA%\electron-builder\Cache`, outside this repository, hence the OK.
Then: install it in your user account, check the welcome screen, a source, thumbnails, Exif reading
(the bundled `exiftool.exe` is the part most likely to break when packaged), workspaces, the screensaver,
and uninstall. Your development library is not touched: the installed app has its own data folder.

### 3. Release workflow in GitHub Actions
Rewrite `release.yml`:
- Triggered by a tag `v*` (and by hand for a test run).
- Three jobs: `windows-latest`, `macos-14` (builds arm64 and x64), `ubuntu-22.04`.
- Node 20, `actions/checkout@v4`, `actions/setup-node@v4` with the yarn cache, `yarn install --frozen-lockfile`,
  `yarn test`, then `yarn build` and `electron-builder --publish always` per platform. No third-party
  build action.
- Signing secrets (Apple ID, team id, app-specific password, certificate; later the Windows signing
  credentials) as repository secrets, used only by this workflow.
- Result: a **draft** GitHub Release with all files and the `latest*.yml` files the updater reads. You
  check it, write the notes, publish.
- Update `test.yml` the same way (Node 20, v4 actions), so every push is tested.

### 4. Getting your own library into the installed Atlas
Your real library lives in the development data folder today. Settings, Import/Export: make a backup in
the development copy and restore it in the installed one. Workspaces are not in backups yet (open
decision in the workspace roadmap); either decide that first, or move the `Atlas_Workspaces` database
along by hand once. Thumbnails are made again on first open.

### 5. Test on each system
| System | Check |
|---|---|
| Windows 10 and 11, clean user account or VM | SmartScreen path, install, start menu, first start, a source on an external drive, ExifTool, updater (install 1.0.0, publish a 1.0.1 draft to a test repo, see it offered), uninstall |
| macOS (Apple Silicon; Intel if possible) | Gatekeeper with the signed and notarized build, ExifTool through the system Perl, multi-monitor screensaver, auto-update |
| Ubuntu 24.04 (VM) | AppImage needs `libfuse2` on 22.04+ (document it), `.deb` install, ExifTool through Perl, the desktop entry and icon |

### 6. The download page
- README: a **Download** section at the top with one link per system, to the latest release's files.
- A small GitHub Pages site (`mibrzozek.github.io/Atlas`): screenshots (generated pictures only), one big
  button that picks the right file for the visitor's system, the others below, and short notes on the
  warnings above while the Windows build is unsigned.
- Release notes per version, written from the commits.

### 7. After 1.0.0
- Windows signing (Azure Trusted Signing) once there are users.
- The Electron upgrade and context isolation (decision 3).
- Optional: winget and Homebrew cask entries (`winget install Atlas`, `brew install --cask atlas`),
  and a Flatpak on Flathub for Linux. Each is a small manifest that points at the GitHub Release.

## Order and size

| Step | Who | Size |
|---|---|---|
| Decisions 1-4 | you | a conversation |
| 1. Atlas everywhere | me | small |
| 2. Local Windows build and test | me, then you install it | small, needs your OK for the download of the build tools |
| 3. Release workflow | me | medium; the first runs on GitHub will need a few fixes |
| Apple Developer account, secrets in GitHub | you | an evening (Apple's identity check can take days) |
| 4. Moving your library | you, with me | small |
| 5. Testing | you on a Mac and Linux, me where it can be done hidden | medium |
| 6. Download page | me | small to medium |

A first unsigned build for all three systems can exist after steps 1-3; a release you can hand to
people after 5.
