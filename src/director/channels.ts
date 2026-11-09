// The Director's messages between the main process and the page: development only, like all of the
// Director (CLAUDE.md). Here so that neither side pulls in the other's code

export const CALL_CHANNEL = 'atlas-director-call';
export const ANSWER_CHANNEL = 'atlas-director-answer';
/** From the page once its Director is installed (the library loaded): commands can be done from then on */
export const READY_CHANNEL = 'atlas-director-ready';

export type DirectorAnswer = { ok: true; result: unknown } | { ok: false; error: string };

/** How long the window is kept from being throttled, and the screensaver from starting, after a command */
export const DIRECTOR_HOLD = 2 * 60_000;
