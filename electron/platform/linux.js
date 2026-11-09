import { app } from 'electron';

const flag = (name, fallback) => (process.env[name] === undefined ? fallback : process.env[name] !== '0');

/**
 * Per-platform behaviour. macOS keeps the original behaviour (bottom strip, pointer interaction, tray);
 * Linux runs a passive, click-through, fixed work-area window. Any option can be overridden with an
 * environment variable (value 0/1), e.g. `MOB_INTERACTIVE=1 npm start`.
 */
export const IS_LINUX = process.platform === 'linux';

export const platform = IS_LINUX
  ? {
      /** Pointer interaction (drag, pet, throw, context menu). Off = window is fully click-through. */
      interactive: flag('MOB_INTERACTIVE', false),
      /** One window covering the work area for the whole session; never resized or moved. */
      fixedWindow: flag('MOB_FIXED_WINDOW', true),
      /** Tray icon (not implemented for Linux yet). */
      tray: flag('MOB_TRAY', false),
    }
  : { interactive: true, fixedWindow: false, tray: true };

/** `focusable:false` turns the X11 window into override-redirect (the WM stops managing it), so it is macOS-only. */
export const FOCUSABLE = !IS_LINUX ? false : true;

/**
 * Must run before `app.whenReady()`. The Ozone backend cannot be chosen from JS (Chromium has already picked it by
 * then), so `scripts/launch.mjs` passes `--ozone-platform=x11` on the real command line to run through XWayland.
 * This only warns when Electron was started some other way, e.g. a bare `npx electron .`.
 */
export function configureProcess() {
  if (!IS_LINUX) return;
  const backend = app.commandLine.getSwitchValue('ozone-platform');
  if (backend !== 'x11') {
    console.warn(`[mob] Electron is using the "${backend || 'default'}" Ozone backend, not X11/XWayland. Start it with \`npm start\` (or pass --ozone-platform=x11).`);
  }
}

/** Window options that only exist on macOS are harmless elsewhere; Linux-specific tweaks go here. */
export function configureWindow(win) {
  if (IS_LINUX) {
    win.setAlwaysOnTop(true);
  } else {
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  win.setIgnoreMouseEvents(true, platform.interactive ? { forward: true } : undefined);
}

/**
 * Linux/X11: both the all-workspaces hint (_NET_WM_DESKTOP) and the click-through input region are lost
 * if set before the window is mapped, so they are (re)applied right after it is shown.
 */
export function configureShownWindow(win) {
  if (!IS_LINUX) return;
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, platform.interactive ? { forward: true } : undefined);
}
