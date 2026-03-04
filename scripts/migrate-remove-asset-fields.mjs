import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function loadDotEnv() {
	const envPath = path.join(ROOT_DIR, '.env');
	if (!fs.existsSync(envPath)) return;
	const raw = fs.readFileSync(envPath, 'utf8');
	for (const line of raw.split(/\r?\n/)) {
		if (!line || line.trim().startsWith('#')) continue;
		const idx = line.indexOf('=');
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim();
		let value = line.slice(idx + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

function findServiceAccountPath() {
	const entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		if (/firebase-adminsdk.*\.json$/i.test(entry.name)) {
			return path.join(ROOT_DIR, entry.name);
		}
	}
	return null;
}

function initAdmin() {
	if (getApps().length > 0) return;

	const projectId = process.env.FIREBASE_PROJECT_ID;
	const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
	const privateKey = process.env.FIREBASE_PRIVATE_KEY;

	if (projectId && clientEmail && privateKey) {
		initializeApp({
			credential: cert({
				projectId,
				clientEmail,
				privateKey: privateKey.replace(/\\n/g, '\n')
			})
		});
		return;
	}

	const serviceAccountPath = findServiceAccountPath();
	if (!serviceAccountPath) {
		throw new Error(
			'No Firebase Admin credentials found. Provide FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY or a firebase-adminsdk JSON key file in repo root.'
		);
	}
	const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
	initializeApp({ credential: cert(serviceAccount) });
}

const FILE_FIELD_PATHS_TO_DELETE = [
	'metadata.assetType',
	'metadata.chromaKeyHex',
	'assetType',
	'chromaKeyHex',
	'activeAsset',
	'activeAssetId',
	'activeAssetFolderId',
	'activeAssetFolderPath'
];

const USER_FIELD_PATHS_TO_DELETE = [
	'activeAsset',
	'activeAssetId',
	'activeAssetFolderId',
	'activeAssetFolderPath'
];

const argv = new Set(process.argv.slice(2));
const isDryRun = argv.has('--dry-run') || !argv.has('--apply');

async function run() {
	loadDotEnv();
	initAdmin();
	const db = getFirestore();

	console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'APPLY'}`);
	console.log('Starting migration: remove legacy asset-oriented fields...');

	const usersSnap = await db.collection('users').get();
	let usersVisited = 0;
	let userDocsTouched = 0;
	let fileDocsVisited = 0;
	let fileDocsTouched = 0;
	let writesPlanned = 0;

	const samplePaths = [];

	for (const userDoc of usersSnap.docs) {
		usersVisited += 1;
		const userData = userDoc.data() || {};
		const userUpdate = {};
		let shouldUpdateUser = false;

		for (const fieldPath of USER_FIELD_PATHS_TO_DELETE) {
			if (Object.prototype.hasOwnProperty.call(userData, fieldPath)) {
				userUpdate[fieldPath] = FieldValue.delete();
				shouldUpdateUser = true;
			}
		}

		if (shouldUpdateUser) {
			userDocsTouched += 1;
			writesPlanned += 1;
			if (samplePaths.length < 20) samplePaths.push(`users/${userDoc.id}`);
			if (!isDryRun) {
				await userDoc.ref.update(userUpdate);
			}
		}

		const filesSnap = await userDoc.ref.collection('files').get();
		for (const fileDoc of filesSnap.docs) {
			fileDocsVisited += 1;
			const fileData = fileDoc.data() || {};
			const metadata = fileData.metadata && typeof fileData.metadata === 'object' ? fileData.metadata : null;
			const fileUpdate = {};
			let shouldUpdateFile = false;

			for (const fieldPath of FILE_FIELD_PATHS_TO_DELETE) {
				if (fieldPath.startsWith('metadata.')) {
					const nestedKey = fieldPath.slice('metadata.'.length);
					if (metadata && Object.prototype.hasOwnProperty.call(metadata, nestedKey)) {
						fileUpdate[fieldPath] = FieldValue.delete();
						shouldUpdateFile = true;
					}
				} else if (Object.prototype.hasOwnProperty.call(fileData, fieldPath)) {
					fileUpdate[fieldPath] = FieldValue.delete();
					shouldUpdateFile = true;
				}
			}

			if (!shouldUpdateFile) continue;
			fileDocsTouched += 1;
			writesPlanned += 1;
			if (samplePaths.length < 20) samplePaths.push(`users/${userDoc.id}/files/${fileDoc.id}`);
			if (!isDryRun) {
				await fileDoc.ref.update(fileUpdate);
			}
		}
	}

	console.log('Migration complete.');
	console.log(`Users visited: ${usersVisited}`);
	console.log(`User docs touched: ${userDocsTouched}`);
	console.log(`File docs visited: ${fileDocsVisited}`);
	console.log(`File docs touched: ${fileDocsTouched}`);
	console.log(`Writes ${isDryRun ? 'planned' : 'executed'}: ${writesPlanned}`);
	if (samplePaths.length > 0) {
		console.log('Sample touched paths:');
		for (const p of samplePaths) console.log(`- ${p}`);
	}
}

run().catch((err) => {
	console.error('Migration failed:', err?.message || err);
	process.exit(1);
});

