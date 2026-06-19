import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = !!firebaseConfig.projectId;

// Only initialise if config is present — avoids crash when env vars are missing
const app = isFirebaseConfigured
  ? (getApps().length ? getApps()[0] : initializeApp(firebaseConfig))
  : null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: ReturnType<typeof getFirestore> = app ? getFirestore(app) : (null as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const auth: ReturnType<typeof getAuth> = app ? getAuth(app) : (null as any);
