import { json } from '@sveltejs/kit';
import { getAdminDb } from '$lib/firebase/admin.js';
import { approxJsonBytes, enforceRateLimit } from '$lib/server/security.js';
import { buildBlenderRigPayload } from '$lib/server/blenderRigPayload.js';
import {
	beginIdempotentRequest,
	completeIdempotentRequest,
	failIdempotentRequest,
	makeRequestHash,
	recordUsageEvent
} from '$lib/server/requestTracking.js';

const REQUIRED_MARKERS = [
	'pelvis',
	'spine',
	'neck',
	'head',
	'shoulder_L',
	'elbow_L',
	'wrist_L',
	'shoulder_R',
	'elbow_R',
	'wrist_R',
	'hip_L',
	'knee_L',
	'ankle_L',
	'hip_R',
	'knee_R',
	'ankle_R'
];

function isSafeHttpUrl(value) {
	try {
		const u = new URL(String(value || ''));
		return u.protocol === 'https:' || u.protocol === 'http:';
	} catch {
		return false;
	}
}

function normalizeMarkerSet(rigSpec) {
	const markers = rigSpec?.markers && typeof rigSpec.markers === 'object' ? rigSpec.markers : {};
	const out = {};
	for (const key of REQUIRED_MARKERS) {
		const val = markers[key];
		if (!val || typeof val !== 'object') continue;
		const x = Number(val.x);
		const y = Number(val.y);
		const z = Number(val.z);
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
		out[key] = { x, y, z };
	}
	return out;
}

export async function POST({ request, locals }) {
	let payloadBytes = 0;
	let idempotencyKey = null;
	let requestHash = null;
	try {
		if (!locals.user) {
			return json({ error: 'Authentication required' }, { status: 401 });
		}

		const { provider, modelUrl, rigSpec, modelPreflight = null } = await request.json();
		const safeProvider = provider === 'mixamo' ? 'mixamo' : 'meshy';
		const safeModelUrl = String(modelUrl || '').trim();
		const safeRigSpec = rigSpec && typeof rigSpec === 'object' ? rigSpec : {};
		const payload = {
			provider: safeProvider,
			modelUrl: safeModelUrl,
			rigSpec: safeRigSpec,
			modelPreflight
		};
		payloadBytes = approxJsonBytes(payload);
		idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || null;
		requestHash = makeRequestHash(payload);
		if (payloadBytes > 1 * 1024 * 1024) {
			return json({ error: 'Request payload too large' }, { status: 413 });
		}
		const rate = enforceRateLimit({
			uid: locals.user.uid,
			routeKey: '3d-rig',
			maxRequests: 20,
			windowMs: 60_000
		});
		if (!rate.allowed) {
			return json(
				{ error: 'Rate limit exceeded. Please try again shortly.' },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}
		if (idempotencyKey) {
			const idempotency = await beginIdempotentRequest({
				uid: locals.user.uid,
				routeKey: '3d-rig',
				idempotencyKey,
				requestHash
			});
			if (idempotency.status === 'replay') {
				return json(idempotency.responseBody, { status: idempotency.responseStatus });
			}
			if (idempotency.status === 'processing') {
				return json(
					{ error: 'A request with this Idempotency-Key is already processing.' },
					{ status: 409 }
				);
			}
			if (idempotency.status === 'conflict') {
				return json(
					{ error: 'Idempotency-Key already used with different payload.' },
					{ status: 409 }
				);
			}
		}

		if (!safeModelUrl) {
			return json({ error: 'Model URL is required for rigging.' }, { status: 400 });
		}
		if (!isSafeHttpUrl(safeModelUrl)) {
			return json({ error: 'Model URL must be a valid http(s) URL.' }, { status: 400 });
		}
		if (safeRigSpec.template !== 'humanoid_v1') {
			return json({ error: 'RigSpec template must be humanoid_v1.' }, { status: 400 });
		}
		const markers = normalizeMarkerSet(safeRigSpec);
		const markerCount = Object.keys(markers).length;
		if (markerCount < 8) {
			return json({ error: 'Place at least 8 rig markers before submitting.' }, { status: 400 });
		}

		const db = getAdminDb();
		const rigJobRef = db.collection('users').doc(locals.user.uid).collection('rig_jobs').doc();
		const rigJobId = rigJobRef.id;
		const blenderPayload = buildBlenderRigPayload({
			jobId: rigJobId,
			modelUrl: safeModelUrl,
			markers,
			options: safeRigSpec?.options || {},
			preflight: modelPreflight && typeof modelPreflight === 'object' ? modelPreflight : null
		});
		await rigJobRef.set({
			jobId: rigJobId,
			type: 'rig_from_markers',
			status: 'queued',
			provider: safeProvider,
			modelUrl: safeModelUrl,
			template: 'humanoid_v1',
			markerCount,
			requiredMarkerCount: REQUIRED_MARKERS.length,
			markers,
			options: {
				ik_hands: !!safeRigSpec?.options?.ik_hands,
				ik_feet: !!safeRigSpec?.options?.ik_feet
			},
			blenderPayload,
			progress: 0,
			message: 'Queued with Blender-ready rig payload.',
			createdAt: new Date(),
			updatedAt: new Date()
		});

		const responseBody = {
			ok: true,
			stage: 'rig_from_markers',
			message: 'Rigging job queued from marker-based rig spec.',
			provider: safeProvider,
			jobId: rigJobId,
			status: 'queued',
			markerCount,
			requiredMarkerCount: REQUIRED_MARKERS.length,
			blenderSpecVersion: blenderPayload.specVersion
		};
		if (idempotencyKey) {
			await completeIdempotentRequest({
				uid: locals.user.uid,
				routeKey: '3d-rig',
				idempotencyKey,
				requestHash,
				responseStatus: 200,
				responseBody
			});
		}
		await recordUsageEvent({
			uid: locals.user.uid,
			routeKey: '3d-rig',
			provider: 'internal',
			statusCode: 200,
			requestBytes: payloadBytes,
			metadata: { provider: safeProvider, markerCount }
		});
		return json(responseBody);
	} catch (error) {
		if (idempotencyKey && requestHash && locals.user?.uid) {
			try {
				await failIdempotentRequest({
					uid: locals.user.uid,
					routeKey: '3d-rig',
					idempotencyKey,
					requestHash,
					errorMessage: error.message
				});
			} catch {
				// best effort
			}
		}
		if (locals.user?.uid) {
			await recordUsageEvent({
				uid: locals.user.uid,
				routeKey: '3d-rig',
				provider: 'internal',
				success: false,
				statusCode: 500,
				requestBytes: payloadBytes,
				metadata: { error: String(error.message || 'unknown').slice(0, 200) }
			});
		}
		return json({ error: error.message || 'Failed to process rigging request.' }, { status: 500 });
	}
}
