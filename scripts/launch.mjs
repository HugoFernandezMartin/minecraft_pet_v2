// Launches Electron. With --dev it also starts the Vite dev server and points Electron at it.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const dev = process.argv.includes('--dev');
const PORT = 5173;
const URL = `http://localhost:${PORT}`;

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (dev) env.VITE_DEV_SERVER_URL = URL;

let vite = null;
if (dev) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'inherit', env });
  for (let i = 0; ; i++) {
    try {
      await fetch(URL);
      break;
    } catch {
      if (i > 100) throw new Error('Vite dev server did not start');
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}
async function hideFromTaskbar() {
  if (process.platform !== 'linux') return;

  for (let i = 0; i < 100; i++) {
    try {
      const { stdout } = await execFileAsync('wmctrl', ['-lx']);

      const window = stdout.split('\n').find(line => {
        const columns = line.trim().split(/\s+/);
        return columns[2] === 'minecraft_pet_v2.minecraft_pet_v2';
      });

      if (window) {
        const windowId = window.trim().split(/\s+/)[0];

        await execFileAsync('wmctrl', [
          '-i', '-r', windowId, '-b', 'add,skip_taskbar'
        ]);

        console.log(`[Linux] Hidden from taskbar: ${windowId}`);
        return;
      }
    } catch (error) {
      console.error('[Linux] Could not hide window from taskbar:', error.message);
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.warn('[Linux] Bee window not found; taskbar state unchanged.');
}
// On Linux Electron must run through XWayland. Chromium picks its Ozone backend while it parses the command line,
// before any JS runs, so this has to be a real argument (app.commandLine.appendSwitch in the main process is too late).
const args = process.platform === 'linux' ? ['.', '--ozone-platform=x11'] : ['.'];
const electron = spawn(require('electron'), args, { stdio: 'inherit', env });
hideFromTaskbar();
const stop = () => {
  vite?.kill();
  electron.kill();
};
electron.on('exit', (code) => {
  vite?.kill();
  process.exit(code ?? 0);
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
