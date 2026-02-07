import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
	apiKey: 'AIzaSyC2WKJ3lnpFfapTiN620OEpyOSIAIUKif4',
	authDomain: 'sprite-magician.firebaseapp.com',
	projectId: 'sprite-magician',
	storageBucket: 'sprite-magician.firebasestorage.app',
	messagingSenderId: '1077410287128',
	appId: '1:1077410287128:web:fec0d035b638d8be753d6d',
	measurementId: 'G-P2M99WPK98'
};

// Initialize Firebase (only once)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export default app;
