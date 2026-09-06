import 'dotenv/config';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function test() {
  try {
    const app = initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
    });
    
    const db = process.env.FIRESTORE_DATABASE_ID ? getFirestore(app, process.env.FIRESTORE_DATABASE_ID) : getFirestore(app);
    console.log(`Testing Firestore connection on database: ${process.env.FIRESTORE_DATABASE_ID || '(default)'}...`);
    await db.collection('test').doc('test').set({ hello: 'world' });
    console.log('Success!');
  } catch (err: any) {
    console.error('Firestore Error:', err.message);
  }
}

test();
