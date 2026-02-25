import { createHash } from 'node:crypto';
import { getAdminDb } from '$lib/firebase/admin.js';
import { approxJsonBytes } from '$lib/server/security.js';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORED_RESPONSE_BYTES = 64 * 1024;
const RUNPOD_JOB_TTL_MS = 24 * 60 * 60 * 1000;

function hashHex(input) {
	return createHash('sha256').update(String(input || '')).digest('hex');
}

function idempotencyDocRef(uid, routeKey, idempotencyKey) {
	const keyHash = hashHex(`${routeKey}:${idempotencyKey}`).slice(0, 48);
	return getAdminDb().collection('users').doc(uid).collection('idempotency').doc(keyHash);
}

function runpodJobDocRef(uid, runpodId) {
	return getAdminDb().collection('users').doc(uid).collection('runpod_jobs').doc(runpodId);
}

function isValidRunpodId(runpodId) {
	return typeof runpodId === 'string' && /^[a-zA-Z0-9_-]{6,128}$/.test(runpodId);
}

export function makeRequestHash(payload) {
	return hashHex(JSON.stringify(payload ?? {}));
}

export async function beginIdempotentRequest({ uid, routeKey, idempotencyKey, requestHash }) {
	if (!uid || !routeKey || !idempotencyKey || !requestHash) return { status: 'disabled' };

	const now = Date.now();
	const ref = idempotencyDocRef(uid, routeKey, idempotencyKey);
	const snap = await ref.get();

	if (snap.exists) {
		const data = snap.data() || {};
		const expiresAtMs = data.expiresAt?.toMillis?.() ?? 0;
		const isExpired = expiresAtMs > 0 && expiresAtMs <= now;
		if (!isExpired) {
			if (data.requestHash !== requestHash) {
				return { status: 'conflict' };
			}
			if (data.status === 'completed' && data.responseBody) {
				return {
					status: 'replay',
					responseBody: data.responseBody,
					responseStatus: Number(data.responseStatus) || 200
				};
			}
			if (data.status === 'processing') {
				return { status: 'processing' };
			}
		}
	}

	await ref.set(
		{
			routeKey,
			requestHash,
			status: 'processing',
			updatedAt: new Date(),
			expiresAt: new Date(now + IDEMPOTENCY_TTL_MS)
		},
		{ merge: true }
	);
	return { status: 'new' };
}

export async function completeIdempotentRequest({
	uid,
	routeKey,
	idempotencyKey,
	requestHash,
	responseStatus = 200,
	responseBody
}) {
	if (!uid || !routeKey || !idempotencyKey || !requestHash) return;
	const ref = idempotencyDocRef(uid, routeKey, idempotencyKey);
	const responseBytes = approxJsonBytes(responseBody);
	await ref.set(
		{
			status: 'completed',
			requestHash,
			responseStatus,
			updatedAt: new Date(),
			responseBody: responseBytes <= MAX_STORED_RESPONSE_BYTES ? responseBody : null
		},
		{ merge: true }
	);
}

export async function failIdempotentRequest({ uid, routeKey, idempotencyKey, requestHash, errorMessage }) {
	if (!uid || !routeKey || !idempotencyKey || !requestHash) return;
	const ref = idempotencyDocRef(uid, routeKey, idempotencyKey);
	await ref.set(
		{
			status: 'failed',
			requestHash,
			errorMessage: String(errorMessage || 'Request failed').slice(0, 500),
			updatedAt: new Date()
		},
		{ merge: true }
	);
}

export async function recordUsageEvent({
	uid,
	routeKey,
	provider,
	billingSource = 'platform',
	success = true,
	statusCode = 200,
	requestBytes = 0,
	metadata = {}
}) {
	if (!uid || !routeKey) return;
	try {
		await getAdminDb().collection('users').doc(uid).collection('usage_ledger').add({
			routeKey,
			provider: provider || 'unknown',
			billingSource,
			success: !!success,
			statusCode: Number(statusCode) || 200,
			requestBytes: Number(requestBytes) || 0,
			metadata: metadata && typeof metadata === 'object' ? metadata : {},
			createdAt: new Date()
		});
	} catch (error) {
		console.warn('[requestTracking] usage ledger write failed:', error?.message || error);
	}
}

export async function registerRunpodJobOwnership({ uid, runpodId, routeKey = 'unknown', metadata = {} }) {
	if (!uid || !isValidRunpodId(runpodId)) return;
	try {
		await runpodJobDocRef(uid, runpodId).set(
			{
				runpodId,
				routeKey,
				metadata: metadata && typeof metadata === 'object' ? metadata : {},
				createdAt: new Date(),
				expiresAt: new Date(Date.now() + RUNPOD_JOB_TTL_MS)
			},
			{ merge: true }
		);
	} catch (error) {
		console.warn('[requestTracking] runpod job ownership write failed:', error?.message || error);
	}
}

export async function hasRunpodJobOwnership({ uid, runpodId }) {
	if (!uid || !isValidRunpodId(runpodId)) return false;
	try {
		const snap = await runpodJobDocRef(uid, runpodId).get();
		if (!snap.exists) return false;
		const data = snap.data() || {};
		const expiresAtMs = data.expiresAt?.toMillis?.() ?? 0;
		if (expiresAtMs > 0 && expiresAtMs <= Date.now()) return false;
		return true;
	} catch (error) {
		console.warn('[requestTracking] runpod job ownership read failed:', error?.message || error);
		return false;
	}
}
