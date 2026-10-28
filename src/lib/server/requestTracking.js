/**
 * Request bookkeeping for a single local user.
 *
 * The hosted version stored idempotency records and a usage ledger in
 * a database. Locally we keep idempotency in memory (it only needs to survive
 * a double-click) and skip the ledger entirely.
 */
import { createHash } from 'node:crypto';
import { approxJsonBytes } from '$lib/server/security.js';
import * as db from './db.js';
import { estimateRouteCost } from './models.js';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORED_RESPONSE_BYTES = 64 * 1024;
const RUNPOD_JOB_TTL_MS = 24 * 60 * 60 * 1000;

const idempotency = new Map();
const runpodJobs = new Map();

function hashHex(input) {
	return createHash('sha256').update(String(input || '')).digest('hex');
}

function idemKey(routeKey, idempotencyKey) {
	return hashHex(`${routeKey}:${idempotencyKey}`).slice(0, 48);
}

function isValidRunpodId(runpodId) {
	return typeof runpodId === 'string' && /^[a-zA-Z0-9_-]{6,128}$/.test(runpodId);
}

function sweep() {
	const now = Date.now();
	for (const [k, v] of idempotency) if (v.expiresAt <= now) idempotency.delete(k);
	for (const [k, v] of runpodJobs) if (v.expiresAt <= now) runpodJobs.delete(k);
}

export function makeRequestHash(payload) {
	return hashHex(JSON.stringify(payload ?? {}));
}

export async function beginIdempotentRequest({ uid, routeKey, idempotencyKey, requestHash }) {
	if (!uid || !routeKey || !idempotencyKey || !requestHash) return { status: 'disabled' };
	sweep();
	const key = idemKey(routeKey, idempotencyKey);
	const existing = idempotency.get(key);
	if (existing) {
		if (existing.requestHash !== requestHash) return { status: 'conflict' };
		if (existing.status === 'completed' && existing.responseBody) {
			return { status: 'replay', responseBody: existing.responseBody, responseStatus: existing.responseStatus || 200 };
		}
		if (existing.status === 'processing') return { status: 'processing' };
	}
	idempotency.set(key, { routeKey, requestHash, status: 'processing', expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
	return { status: 'new' };
}

export async function completeIdempotentRequest({ uid, routeKey, idempotencyKey, requestHash, responseStatus = 200, responseBody }) {
	if (!uid || !routeKey || !idempotencyKey || !requestHash) return;
	const key = idemKey(routeKey, idempotencyKey);
	idempotency.set(key, {
		routeKey,
		requestHash,
		status: 'completed',
		responseStatus,
		responseBody: approxJsonBytes(responseBody) <= MAX_STORED_RESPONSE_BYTES ? responseBody : null,
		expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
	});
}

export async function failIdempotentRequest({ uid, routeKey, idempotencyKey, requestHash, errorMessage }) {
	if (!uid || !routeKey || !idempotencyKey || !requestHash) return;
	const key = idemKey(routeKey, idempotencyKey);
	idempotency.set(key, {
		routeKey,
		requestHash,
		status: 'failed',
		errorMessage: String(errorMessage || 'Request failed').slice(0, 500),
		expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
	});
}

/** Locally this only feeds the cost estimate shown in the UI. */
export async function recordUsageEvent({ routeKey, success = true, statusCode = 200, metadata = {} } = {}) {
	if (!routeKey || !success || statusCode >= 400) return;
	if (['generate-animation', 'remove-background', 'upscale', 'live-portrait', 'generate-sprite', 'generate-frames', 'generate-character-sheet', 'generate-styled-character', 'edit-image', 'design-chat'].includes(routeKey)) {
		try { recordSpend(routeKey, metadata, Number(metadata?.count) || 1); } catch (err) { console.warn('[usage]', err?.message); }
	}
}

export async function registerRunpodJobOwnership({ uid, runpodId, routeKey = 'unknown', metadata = {} }) {
	if (!uid || !isValidRunpodId(runpodId)) return;
	runpodJobs.set(runpodId, { routeKey, metadata, expiresAt: Date.now() + RUNPOD_JOB_TTL_MS });
}

export async function hasRunpodJobOwnership({ uid, runpodId }) {
	if (!uid || !isValidRunpodId(runpodId)) return false;
	const rec = runpodJobs.get(runpodId);
	return !!rec && rec.expiresAt > Date.now();
}

// ── Spend tracking (estimates) ───────────────────────────────────────────

const USAGE_COL = 'usage';
const USAGE_ID = 'totals';

export function getUsageTotals() {
	return db.getDoc(USAGE_COL, USAGE_ID) || { id: USAGE_ID, spentUsd: 0, runs: 0, byRoute: {}, since: new Date().toISOString() };
}

export function resetUsageTotals() {
	db.setDoc(USAGE_COL, USAGE_ID, { spentUsd: 0, runs: 0, byRoute: {}, since: new Date().toISOString() });
}

/** Add an estimated cost for a successful provider call. */
export function recordSpend(routeKey, metadata = {}, count = 1) {
	const cost = estimateRouteCost(routeKey, metadata) * count;
	if (!cost) return;
	const t = getUsageTotals();
	const byRoute = { ...(t.byRoute || {}) };
	byRoute[routeKey] = Number(((byRoute[routeKey] || 0) + cost).toFixed(4));
	db.setDoc(USAGE_COL, USAGE_ID, {
		spentUsd: Number(((t.spentUsd || 0) + cost).toFixed(4)),
		runs: (t.runs || 0) + count,
		byRoute,
		since: t.since || new Date().toISOString()
	});
}
