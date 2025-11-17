import { app, BrowserWindow, Menu, ipcMain, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import isDev from 'electron-is-dev';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    // Try common dev ports in order
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createMenu();
};

const createMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', selector: 'redo:' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'geolocation') {
      callback(true);
    } else {
      callback(false);
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle any uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// ==============================================================================
// IPC Handlers
// ==============================================================================

/**
 * Run PathFinder simulation
 */
ipcMain.handle('pathfinder:run', async (event, { worldExport, pythonPath = 'python3' }) => {
  try {
    // PathFinder directory (relative to project root)
    const pathFinderDir = path.join(__dirname, '..', 'PathFinder');
    const mainPy = path.join(pathFinderDir, 'main.py');

    // Spawn Python process
    const pythonProcess = spawn(pythonPath, [mainPy], {
      cwd: pathFinderDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutData = '';
    let stderrData = '';
    const events = [];

    // Collect stdout (JSONL events)
    pythonProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          events.push(event);
        } catch (err) {
          stdoutData += line + '\n';
        }
      }
    });

    // Collect stderr
    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    // Wait for process to complete
    const exitCode = await new Promise((resolve, reject) => {
      pythonProcess.on('close', (code) => {
        resolve(code);
      });
      pythonProcess.on('error', (error) => {
        reject(error);
      });

      // Send world export via stdin
      pythonProcess.stdin.write(JSON.stringify(worldExport) + '\n');
      pythonProcess.stdin.end();

      // Timeout after 30 seconds
      setTimeout(() => {
        pythonProcess.kill();
        reject(new Error('PathFinder process timed out'));
      }, 30000);
    });

    return {
      success: exitCode === 0,
      events,
      stdout: stdoutData,
      stderr: stderrData,
      exitCode,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

/**
 * Save mission data to file
 */
ipcMain.handle('file:save', async (event, { filename, content }) => {
  try {
    const savePath = path.join(app.getPath('userData'), 'missions', filename);
    await writeFile(savePath, content, 'utf-8');
    return { success: true, path: savePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/**
 * Get application paths
 */
ipcMain.handle('app:getPaths', async () => {
  return {
    userData: app.getPath('userData'),
    projectRoot: path.join(__dirname, '..'),
    pathFinder: path.join(__dirname, '..', 'PathFinder'),
  };
});


// ==============================================================================
// Serial Port IPC (Pi connection)
// ==============================================================================
let SerialPortLib = null; // { SerialPort, Parsers }
let serialPort = null;
let readlineParser = null;

async function ensureSerialLib() {
  if (SerialPortLib) return true;
  try {
    const spMod = await import('serialport');
    const SerialPort = (spMod && (spMod.SerialPort || spMod.default || spMod));
    const parserMod = await import('@serialport/parser-readline');
    const Readline = (parserMod && (parserMod.ReadlineParser || parserMod.default || parserMod));
    SerialPortLib = { SerialPort, Parsers: { Readline } };
    return true;
  } catch (e) {
    console.warn('[Serial] serialport not available:', e && (e.message || String(e)));
    return false;
  }
}

function broadcastStatus(win, status) {
  try { win.webContents.send('serial:status', status); } catch {}
}
function broadcastLine(win, line) {
  try { win.webContents.send('serial:line', line); } catch {}
}

ipcMain.handle('serial:listPorts', async () => {
  if (!(await ensureSerialLib())) return { success: false, error: 'serialport not installed' };
  try {
    const ports = await SerialPortLib.SerialPort.list();
    return { success: true, ports };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('serial:open', async (event, { port, baud }) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!(await ensureSerialLib())) {
    broadcastStatus(win, { connected: false, error: 'serialport not installed' });
    return { success: false, error: 'serialport not installed' };
  }
  try {
    if (serialPort) {
      try { serialPort.close(); } catch {}
      serialPort = null;
    }
    serialPort = new SerialPortLib.SerialPort({ path: port, baudRate: Number(baud) || 9600, autoOpen: true });
    // Attach parser
    const ParserCtor = SerialPortLib.Parsers?.Readline || SerialPortLib.Parsers?.ReadlineParser;
    readlineParser = new ParserCtor({ delimiter: '\n' });
    serialPort.pipe(readlineParser);

    serialPort.on('open', () => broadcastStatus(win, { connected: true, port, baud }));
    serialPort.on('error', (err) => broadcastStatus(win, { connected: false, error: err?.message || String(err) }));
    serialPort.on('close', () => broadcastStatus(win, { connected: false }));

    readlineParser.on('data', (line) => {
      const lineStr = String(line).trim();
      console.log('[ELECTRON] [RX] Received:', lineStr);
      broadcastLine(win, lineStr);
    });

    return { success: true };
  } catch (e) {
    broadcastStatus(win, { connected: false, error: e?.message || String(e) });
    return { success: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('serial:close', async () => {
  try {
    if (serialPort) {
      await new Promise((res) => serialPort.close(() => res(null)));
    }
    serialPort = null;
    readlineParser = null;
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('serial:writeLine', async (event, { data }) => {
  if (!serialPort) return { success: false, error: 'not connected' };
  try {
    const line = typeof data === 'string' ? data : JSON.stringify(data);
    console.log('[ELECTRON] [TX] Sending:', line.trim());
    await new Promise((res, rej) => serialPort.write(line.endsWith('\n') ? line : line + '\n', (err) => err ? rej(err) : res(null)));
    return { success: true };
  } catch (e) {
    console.error('[ELECTRON] [TX] Write error:', e?.message || String(e));
    return { success: false, error: e?.message || String(e) };
  }
});
