import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, powerMonitor, screen, globalShortcut } from 'electron';
import { MOBS, SIZES, loadSettings, saveSettings } from './settings.js';
import { FOCUSABLE, configureProcess, configureShownWindow, configureWindow, platform } from './platform/linux.js';

configureProcess();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const STRIP_HEIGHT_RATIO = 2.6;
const IDLE_POLL_MS = 15_000;
const ASLEEP = new Set(['sleep', 'sleepy']);

const settings = loadSettings();
let win = null;
let tray = null;
let beeState = 'boot';
let idleSleeping = false;
let expanded = false;

if (!app.requestSingleInstanceLock()) {
  console.log('Minecraft Mob is already running (check the menu bar). Quitting this copy.');
  app.quit();
}

// A short strip along the bottom normally; the full work area while the bee is being carried or falling.
function stripBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  if (platform.fixedWindow) return { ...workArea };
  const height = expanded ? workArea.height : Math.min(workArea.height, Math.round(settings.petSize * STRIP_HEIGHT_RATIO));
  return { x: workArea.x, y: workArea.y + workArea.height - height, width: workArea.width, height };
}

function createWindow() {
  win = new BrowserWindow({
    ...stripBounds(),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: FOCUSABLE,
    skipTaskbar: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    hiddenInMissionControl: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  configureWindow(win);
  win.once('ready-to-show', () => {
    win.showInactive();
    configureShownWindow(win);
  });
  win.on('closed', () => (win = null));

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

/** Re-apply bounds only when they actually changed (a no-op setBounds still costs a resize round trip on X11). */
function syncBounds() {
  if (!win) return;
  const next = stripBounds();
  const cur = win.getBounds();
  if (cur.x !== next.x || cur.y !== next.y || cur.width !== next.width || cur.height !== next.height) win.setBounds(next);
}

const send = (channel, payload) => win?.webContents.send(channel, payload);
const command = (type, extra = {}) => send('command', { type, ...extra });

function applySettings(patch) {
  const prevSize = settings.petSize;
  Object.assign(settings, patch);
  saveSettings(settings);
  if (settings.petSize !== prevSize) syncBounds();
  if ('openAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
  send('settings', settings);
  if (platform.tray) buildTray();
}

function toggleMob() {
  const mobNames = Object.keys(MOBS);
  const currentIndex = mobNames.indexOf(settings.mob);
  const nextIndex = (currentIndex + 1) % mobNames.length;
  const next = mobNames[nextIndex];

  applySettings({ mob: next });

  console.log(`[Shortcut] Mob changed: ${settings.mob} -> ${next}`);
}

function buildTray() {
  if (!tray) {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'trayTemplate.png'));
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('Minecraft Mob');
  }
  const asleep = ASLEEP.has(beeState);
  const radio = (label, key, value) => ({ label, type: 'radio', checked: settings[key] === value, click: () => applySettings({ [key]: value }) });

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: asleep ? 'Wake up' : 'Go to sleep', click: () => command('trigger', { name: asleep ? 'wake' : 'sleepy' }) },
    { label: 'Dance', click: () => command('trigger', { name: 'dance' }), enabled: !asleep },
    { label: 'Wave', click: () => command('trigger', { name: 'wave' }), enabled: !asleep },
    { type: 'separator' },
    { label: 'Wanders around', type: 'checkbox', checked: settings.autoWalk, click: (i) => applySettings({ autoWalk: i.checked }) },
    {
      label: 'Mob',
      submenu: Object.entries(MOBS).map(([key, label]) => radio(label, 'mob', key)),
    },
    {
      label: 'Size',
      submenu: Object.entries(SIZES).map(([name, px]) => radio(name[0].toUpperCase() + name.slice(1), 'petSize', px)),
    },
    {
      label: 'Sleep when idle',
      submenu: [radio('Never', 'idleSleepMin', 0), radio('After 2 min', 'idleSleepMin', 2), radio('After 5 min', 'idleSleepMin', 5), radio('After 15 min', 'idleSleepMin', 15)],
    },
    { label: 'Open at login', type: 'checkbox', checked: settings.openAtLogin, click: (i) => applySettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Quit Minecraft Mob', role: 'quit' },
  ]));
}

function pollIdle() {
  const idle = powerMonitor.getSystemIdleTime();
  const limit = settings.idleSleepMin * 60;
  if (limit > 0 && !idleSleeping && idle >= limit) {
    idleSleeping = true;
    if (!ASLEEP.has(beeState)) command('trigger', { name: 'sleepy' });
  } else if (idleSleeping && idle < IDLE_POLL_MS / 1000) {
    idleSleeping = false;
    if (ASLEEP.has(beeState)) command('trigger', { name: 'wake', surprised: true });
  }
}

ipcMain.handle('settings:get', () => settings);
ipcMain.on('settings:set', (_e, patch) => applySettings(patch));
ipcMain.handle('platform:get', () => platform);
ipcMain.on('pointer:over', (_e, over) => {
  if (platform.interactive) win?.setIgnoreMouseEvents(!over, { forward: true });
});
ipcMain.on('window:expand', (_e, on) => {
  if (on === expanded) return;
  expanded = on;
  syncBounds();
});
ipcMain.on('state', (_e, name) => {
  if (ASLEEP.has(name) !== ASLEEP.has(beeState)) {
    beeState = name;
    if (platform.tray) buildTray();
  } else beeState = name;
});

app.whenReady().then(() => {
  app.dock?.hide();
  createWindow();

  const registered = globalShortcut.register('F15', toggleMob);

  if (registered) {
    console.log('[Shortcut] F15 registered: toggle mob');
  } else {
    console.error('[Shortcut] Failed to register F15');
  }

  if (platform.tray) buildTray();
  setInterval(pollIdle, IDLE_POLL_MS);
  screen.on('display-metrics-changed', syncBounds);
  screen.on('display-added', syncBounds);
  screen.on('display-removed', syncBounds);
});

app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => win?.showInactive());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
