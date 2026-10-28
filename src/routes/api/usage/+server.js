/**
 * GET    /api/usage   → { spentUsd, runs, byRoute, since }
 * DELETE /api/usage   → reset the running total
 */
import { json } from '@sveltejs/kit';
import { getUsageTotals, resetUsageTotals } from '$lib/server/requestTracking.js';
import { MODELS } from '$lib/server/models.js';

export async function GET() {
	return json({ ...getUsageTotals(), models: MODELS });
}

export async function DELETE() {
	resetUsageTotals();
	return json(getUsageTotals());
}
