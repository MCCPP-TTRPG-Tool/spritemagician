/**
 * Electron shell for Sprite Magician.
 *
 * Starts the SvelteKit Node server (build/index.js) inside the main process
 * on a free loopback port, then opens a window pointing at it.
 *
 * Data lives in ~/SpriteMagician unless SPRITEMAGICIAN_DATA_DIR is set
 * (same default as running from a terminal).
 */
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const fs = require('node:fs');

// Only one copy of the app may run: two servers writing the same index would corrupt it.
if (!app.requestSingleInstanceLock()) {
	app.quit();
	return;
}

function resolveDataDir() {
	if (!process.env.SPRITEMAGICIAN_DATA_DIR) {
		process.env.SPRITEMAGICIAN_DATA_DIR = path.join(os.homedir(), 'SpriteMagician');
	}
	fs.mkdirSync(process.env.SPRITEMAGICIAN_DATA_DIR, { recursive: true });
	return process.env.SPRITEMAGICIAN_DATA_DIR;
}
const DATA_DIR = resolveDataDir();

// Bundled read-only resources (example images, workflow templates).
process.env.SPRITEMAGICIAN_RESOURCES_DIR = app.isPackaged
	? process.resourcesPath
	: path.join(__dirname, '..', 'static');

let mainWindow = null;
let serverOrigin = null;

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
	if (serverOrigin) return serverOrigin;
	const port = await getFreePort();

	process.env.PORT = String(port);
	process.env.HOST = '127.0.0.1';
	process.env.ORIGIN = `http://127.0.0.1:${port}`;
	process.env.BODY_SIZE_LIMIT = process.env.BODY_SIZE_LIMIT || '512M';

	const serverEntry = path.join(__dirname, '..', 'build', 'index.js');
	if (!fs.existsSync(serverEntry)) {
		throw new Error(`Server build not found at ${serverEntry}. Run "npm run build" first.`);
	}
	await import(`file://${serverEntry.replace(/\\/g, '/')}`);
	serverOrigin = process.env.ORIGIN;
	return serverOrigin;
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

	const isAppUrl = (target) => target.startsWith(url);

	// New windows: open http(s) links in the system browser, deny everything else.
	mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
		if (isAppUrl(target)) return { action: 'allow' };
		if (/^https?:\/\//i.test(target)) shell.openExternal(target);
		return { action: 'deny' };
	});

	// In-window navigation must stay on the app origin.
	mainWindow.webContents.on('will-navigate', (event, target) => {
		if (!isAppUrl(target)) {
			event.preventDefault();
			if (/^https?:\/\//i.test(target)) shell.openExternal(target);
		}
	});

	mainWindow.loadURL(url);
	mainWindow.on('closed', () => {
		mainWindow = null;
	});
}

function buildMenu() {
	const template = [
		{
			label: 'File',
			submenu: [
				{ label: 'Open Data Folder', click: () => shell.openPath(DATA_DIR) },
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

app.on('second-instance', () => {
	if (mainWindow) {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	}
});

app.whenReady().then(async () => {
	try {
		const url = await startServer();
		buildMenu();
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

process.on('unhandledRejection', (err) => console.error('[electron] unhandled rejection', err));
