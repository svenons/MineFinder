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
      preload: path.join(__dirname, 'preload.js'),
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
