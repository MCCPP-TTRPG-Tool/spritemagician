import { redirect } from '@sveltejs/kit';
import { getAdminDb } from '$lib/firebase/admin.js';

export async function load({ locals }) {
	if (!locals.user?.uid) {
		throw redirect(302, '/login');
	}

	const db = getAdminDb();
	const userRef = db.collection('users').doc(locals.user.uid);
	const userDoc = await userRef.get();
	const userData = userDoc.exists ? userDoc.data() : {};

	if (userData?.onboarding?.completed) {
		throw redirect(302, '/');
	}

	return {
		user: locals.user
	};
}

