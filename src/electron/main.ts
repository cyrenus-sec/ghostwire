import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'path';
import { exec } from 'child_process';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;

// Register IPC handlers early
ipcMain.handle('execute-http-cli', async (_event, args: string[]) => {
    console.log('[Main] IPC handler execute-http-cli called with args:', args);
    return new Promise((resolve) => {
        const command = `httpcli ${args.join(' ')}`;

        console.log('[Main] Executing command:', command);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('[Main] Command execution error:', error);
                resolve({ error: error.message, stderr, stdout });
                return;
            }
            console.log('[Main] Command executed successfully');
            resolve({ stdout, stderr });
        });
    });
});

ipcMain.handle('open-file', async () => {
    console.log('[Main] IPC handler open-file called');
    if (!mainWindow) {
        console.error('[Main] No main window available for dialog');
        return { error: 'Internal error: No window' };
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (canceled) {
        console.log('[Main] File selection canceled');
        return null;
    }

    try {
        console.log('[Main] Reading file:', filePaths[0]);
        const content = fs.readFileSync(filePaths[0], 'utf8');
        console.log('[Main] File read successfully, content length:', content.length);
        return content;
    } catch (err: any) {
        console.error('[Main] Failed to read file:', err);
        return { error: 'Failed to read file: ' + err.message };
    }
});

function createMenu() {
    const template: any[] = [
        {
            label: 'File',
            submenu: [
                { label: 'New Request', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu-new-request') },
                { type: 'separator' },
                { label: 'Import', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu-import') },
                { label: 'Export', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('menu-export') },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
                { type: 'separator' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Documentation',
                    click: async () => {
                        await shell.openExternal('https://github.com/cyrenus-sec/ghostwire');
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

console.log('[Main] IPC handlers registered');

app.on('ready', () => {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'Ghostwire',
        backgroundColor: '#1e1e1e',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    })

    createMenu();

    // In dev, vite usually runs on 5173
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

    if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
        console.log('[Main] Loading dev URL:', devUrl);
        mainWindow.loadURL(devUrl).catch((err) => {
            console.log('[Main] Failed to load dev URL:', err.message);
            const filePath = path.join(app.getAppPath(), 'dist-react/index.html');
            console.log('[Main] Falling back to local file:', filePath);
            mainWindow?.loadFile(filePath);
        });
    } else {
        const filePath = path.join(app.getAppPath(), 'dist-react/index.html');
        console.log('[Main] Loading local file:', filePath);
        mainWindow.loadFile(filePath);
    }

    // Context menu
    mainWindow.webContents.on('context-menu', (_e, props) => {
        const menu = Menu.buildFromTemplate([
            { role: 'cut', visible: props.isEditable },
            { role: 'copy', visible: props.isEditable || props.selectionText.length > 0 },
            { role: 'paste', visible: props.isEditable },
            { type: 'separator' },
            { role: 'selectAll' }
        ]);
        menu.popup();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
