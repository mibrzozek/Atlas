/**
 * The Director, main process: development only (`src/main.ts` starts it behind
 * `process.env.NODE_ENV === 'development'` and `!app.isPackaged`; the production build leaves this file
 * out, and `scripts/check-production-bundle.js` fails if it is in it). See CLAUDE.md and
 * docs/director-plan.md.
 *
 * A local server (this computer only, a random port and token, both written to `.director/` in the
 * repository) that takes a command's name and JSON arguments and hands them to the page, which does only
 * the commands on its list, with the stores. It runs no other code. The only files it touches are the names in
 * `audio/` (a song is a plain name, matched against what is really there) and new files in `demo/`; no
 * answer carries a path.
 */
import crypto from 'crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import fse from 'fs-extra';
import http from 'http';
import { AddressInfo } from 'net';
import path from 'path';

import { MUSIC_EXTENSIONS } from '../../common/video';
import {
  ANSWER_CHANNEL,
  CALL_CHANNEL,
  DIRECTOR_HOLD,
  DirectorAnswer,
  READY_CHANNEL,
} from './channels';

/**
 * What a command's name looks like. Which commands there are is the page's list
 * (`src/frontend/director`), which refuses any other name: a command added there needs a reload of the
 * window, not a restart of Atlas
 */
const COMMAND_NAME = /^[a-z][A-Za-z]{0,31}$/;
/** The most a command's body may be */
const MAX_BODY = 64 * 1024;
/** How long the page has for a command (saving a video takes the longest) */
const PAGE_TIMEOUT = 30 * 60_000;
/**
 * How long a command waits for the page to be ready (starting, or reloaded: the library loaded and the
 * Director installed) before it is answered that it was not
 */
const READY_TIMEOUT = 3 * 60_000;

export function startDirector(windowOf: () => BrowserWindow | null): void {
  // The repository: the build is in build/ inside it
  const repo = path.resolve(__dirname, '..');
  if (!fse.existsSync(path.join(repo, 'package.json'))) {
    return;
  }
  const folder = path.join(repo, '.director');
  const audio = path.join(repo, 'audio');
  const demo = path.join(repo, 'demo');
  // The hidden copy (scripts/dev/hidden.js) has a profile of its own: its connection is another file
  const kind = app.getPath('userData').includes('.dev-hidden-profile') ? 'hidden' : 'user';
  const connectionFile = path.join(folder, `${kind}.json`);
  const token = crypto.randomBytes(32).toString('hex');

  let nextId = 0;
  const pending = new Map<number, (answer: DirectorAnswer) => void>();
  ipcMain.on(ANSWER_CHANNEL, (_, { id, answer }: { id: number; answer: DirectorAnswer }) => {
    pending.get(id)?.(answer);
    pending.delete(id);
  });
  /** Commands sent to a page that went away (reloaded, crashed) are never answered: answered here */
  const failPending = (error: string) => {
    for (const [id, answer] of pending) {
      answer({ ok: false, error });
      pending.delete(id);
    }
  };

  // Whether the page can take commands: from its READY until it goes away. Atlas starting (a large
  // library takes a while) or reloading is not ready, and a command then waits for it, never in vain
  let isReady = false;
  let whenReady: Array<() => void> = [];
  ipcMain.on(READY_CHANNEL, () => {
    isReady = true;
    whenReady.forEach((wake) => wake());
    whenReady = [];
  });
  const watched = new WeakSet<BrowserWindow>();
  const watch = (window: BrowserWindow) => {
    if (watched.has(window)) {
      return;
    }
    watched.add(window);
    const gone = (why: string) => {
      isReady = false;
      failPending(why);
    };
    window.webContents.on('did-start-navigation', (_, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        gone('The window was reloaded');
      }
    });
    window.webContents.on('render-process-gone', () => gone('The window crashed'));
  };
  const ready = (window: BrowserWindow): Promise<boolean> =>
    isReady
      ? Promise.resolve(true)
      : new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), READY_TIMEOUT);
          whenReady.push(() => {
            clearTimeout(timer);
            resolve(!window.isDestroyed());
          });
        });

  const inPage = async (method: string, args: unknown[]): Promise<DirectorAnswer> => {
    const window = windowOf();
    if (window === null || window.isDestroyed()) {
      return { ok: false, error: 'Atlas has no window open' };
    }
    watch(window);
    if (!(await ready(window))) {
      return { ok: false, error: `Atlas was not ready within ${READY_TIMEOUT / 1000} s` };
    }
    return new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({
          ok: false,
          error: `${method} took longer than ${PAGE_TIMEOUT / 60_000} minutes`,
        });
      }, PAGE_TIMEOUT);
      pending.set(id, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      window.webContents.send(CALL_CHANNEL, { id, method, args });
    });
  };

  // While commands come: the window is not throttled (it may be covered, or the screen asleep)
  let release: ReturnType<typeof setTimeout> | undefined;
  const hold = () => {
    const window = windowOf();
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.setBackgroundThrottling(false);
    clearTimeout(release);
    release = setTimeout(() => {
      if (!window.isDestroyed()) {
        window.webContents.setBackgroundThrottling(true);
      }
    }, DIRECTOR_HOLD);
  };

  /** The songs in audio/: its files with a music extension, never a folder, a link or anything else */
  const songs = async (): Promise<string[]> => {
    const entries = await fse.readdir(audio, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => MUSIC_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase()));
  };

  const run = async (method: string, args: unknown[]): Promise<DirectorAnswer> => {
    if (method === 'whoAmI') {
      return { ok: true, result: { kind } };
    }
    if (method === 'songs') {
      return { ok: true, result: await songs() };
    }
    if (!COMMAND_NAME.test(method)) {
      return { ok: false, error: `No such command: ${method}` };
    }
    hold();
    if (method === 'reload') {
      return reload();
    }
    if (method === 'restart') {
      return restart();
    }
    if (method === 'music') {
      // A name exactly as it is in audio/, made into its place there only here
      const [workspace, name] = args;
      if (typeof name !== 'string' || !(await songs()).includes(name)) {
        return { ok: false, error: 'Not a song in audio/: ' + String(name) };
      }
      return inPage('music', [workspace, path.join(audio, name)]);
    }
    if (method === 'save') {
      const [workspace, size] = args;
      if (size !== 'phone' && size !== 'full') {
        return { ok: false, error: 'The size is phone or full' };
      }
      await fse.mkdir(demo).catch(() => undefined);
      const answer = await inPage('save', [workspace, size, demo]);
      // The name of the new file, not where it is
      return answer.ok && typeof answer.result === 'string'
        ? { ok: true, result: path.basename(answer.result) }
        : answer;
    }
    return inPage(method, args);
  };

  /**
   * The window loaded again (as Ctrl+R does: a change to the page is then in it), answered once its
   * Director answers again; commands still waiting are told it reloaded
   */
  const reload = async (): Promise<DirectorAnswer> => {
    const window = windowOf();
    if (window === null || window.isDestroyed()) {
      return { ok: false, error: 'Atlas has no window open' };
    }
    watch(window);
    const started = Date.now();
    isReady = false;
    failPending('The window was reloaded');
    window.webContents.reloadIgnoringCache();
    const answer = await inPage('ready', []);
    return answer.ok
      ? { ok: true, result: `ready after ${((Date.now() - started) / 1000).toFixed(1)} s` }
      : answer;
  };

  /**
   * Atlas closed and started again by itself (a change to the main process is then in it): answered at
   * once, before it goes. Started by Atlas, the new one belongs to nothing that runs a command, so it
   * lives on whatever happens to that command. `atlas.js restart` waits for it to be ready
   */
  const restart = (): DirectorAnswer => {
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 300);
    return { ok: true, result: 'restarting' };
  };

  /** An error never says where anything is: a file that could not be read names its path */
  const withoutPaths = (error: string) =>
    error.replace(/(file:\/\/\/?|[A-Za-z]:[\\/]|\\\\)[^'"\n]*/g, '(a path)');

  const server = http.createServer((request, response) => {
    const reply = (status: number, answer: DirectorAnswer) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(answer.ok ? answer : { ...answer, error: withoutPaths(answer.error) }),
      );
    };
    const { port } = server.address() as AddressInfo;
    // Compared as digests: equal lengths whatever was sent, and in constant time
    const digest = (text: string) => crypto.createHash('sha256').update(text).digest();
    const isToken = crypto.timingSafeEqual(
      digest(String(request.headers['x-atlas-token'] ?? '')),
      digest(token),
    );
    // Only this computer by the address it was given (no other name: no DNS rebinding), with the token
    if (
      request.method !== 'POST' ||
      request.url !== '/call' ||
      request.headers.host !== `127.0.0.1:${port}` ||
      !isToken
    ) {
      reply(403, { ok: false, error: 'Refused' });
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        request.destroy();
      }
    });
    request.on('end', async () => {
      try {
        const { method, args } = JSON.parse(body);
        if (typeof method !== 'string' || !Array.isArray(args)) {
          reply(400, { ok: false, error: 'A call is { method, args: [...] }' });
          return;
        }
        reply(200, await run(method, args));
      } catch (e) {
        reply(400, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    fse.mkdirSync(folder, { recursive: true });
    fse.writeJsonSync(connectionFile, { port, token, kind });
  });
  app.on('quit', () => {
    server.close();
    fse.removeSync(connectionFile);
  });
}
