/**
 * Electron shell for Sprite Magician.
 *
 * Starts the SvelteKit Node server (build/index.js) inside the main process
 * on a free localhost port, then opens a window pointing at it.
 * All data is stored under the OS "user data" folder unless
 * SPRITEMAGICIAN_DATA_DIR is set.
 */
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');

const isDev = !app.isPackaged;

// Keep Electron's own cache/profile next to the app data so everything lives in one place.
function resolveDataDir() {
	if (!process.env.SPRITEMAGICIAN_DATA_DIR) {
		process.env.SPRITEMAGICIAN_DATA_DIR = path.join(app.getPath("documents"), "SpriteMagician");
	}
	fs.mkdirSync(process.env.SPRITEMAGICIAN_DATA_DIR, { recursive: true });
	return process.env.SPRITEMAGICIAN_DATA_DIR;
}
const DATA_DIR = resolveDataDir();
app.setPath("userData", path.join(DATA_DIR, ".electron"));
app.setPath("sessionData", path.join(DATA_DIR, ".electron", "session"));
let mainWindow = null;
let serverStarted = false;

function getFreePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

async function startServer() {
	if (serverStarted) return;
	const port = await getFreePort();

	process.env.PORT = String(port);
	process.env.HOST = '127.0.0.1';
	process.env.ORIGIN = `http://127.0.0.1:${port}`;
	process.env.BODY_SIZE_LIMIT = process.env.BODY_SIZE_LIMIT || '512M';

	// Keep the style-anchor fallback (static/Example images) resolvable.
	process.chdir(path.join(__dirname, '..'));

	const serverEntry = path.join(__dirname, '..', 'build', 'index.js');
	if (!fs.existsSync(serverEntry)) {
		throw new Error(`Server build not found at ${serverEntry}. Run "npm run build" first.`);
	}
	await import(`file://${serverEntry.replace(/\\/g, '/')}`);
	serverStarted = true;
	return `http://127.0.0.1:${port}`;
}

function createWindow(url) {
	mainWindow = new BrowserWindow({
		width: 1480,
		height: 920,
		minWidth: 1024,
		minHeight: 640,
		title: 'Sprite Magician',
		backgroundColor: '#f9fafb',
		autoHideMenuBar: true,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true
		}
	});

	// Open external links in the system browser.
	mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
		if (/^https?:\/\//i.test(target) && !target.startsWith(url)) {
			shell.openExternal(target);
			return { action: 'deny' };
		}
		return { action: 'allow' };
	});

	mainWindow.loadURL(url);
	mainWindow.on('closed', () => {
		mainWindow = null;
	});
}

function buildMenu(dataDir) {
	const template = [
		{
			label: 'File',
			submenu: [
				{
					label: 'Open Data Folder',
					click: () => shell.openPath(dataDir)
				},
				{ type: 'separator' },
				{ role: 'quit' }
			]
		},
		{ role: 'editMenu' },
		{
			label: 'View',
			submenu: [
				{ role: 'reload' },
				{ role: 'toggleDevTools' },
				{ type: 'separator' },
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' }
			]
		},
		{ role: 'windowMenu' }
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
	try {
		const url = await startServer();
		buildMenu(DATA_DIR);
		createWindow(url);
		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
		});
	} catch (err) {
		dialog.showErrorBox('Sprite Magician failed to start', String(err?.stack || err));
		app.quit();
	}
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

if (isDev) {
	process.on('unhandledRejection', (err) => console.error('[electron] unhandled rejection', err));
}
