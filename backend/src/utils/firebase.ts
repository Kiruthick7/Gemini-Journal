import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../config/index.js';

const app = initializeApp({
  credential: applicationDefault(),
  ...(config.GOOGLE_CLOUD_PROJECT && { projectId: config.GOOGLE_CLOUD_PROJECT }),
});

export const auth = getAuth(app);
console.log('Firebase initializing with database ID:', config.FIRESTORE_DATABASE_ID || '(default)');
export const db = config.FIRESTORE_DATABASE_ID ? getFirestore(app, config.FIRESTORE_DATABASE_ID) : getFirestore(app);

db.settings({ ignoreUndefinedProperties: true });
