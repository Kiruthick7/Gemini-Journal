#!/bin/bash

# 1. Create Directory Structure
mkdir -p backend/src/config backend/src/middleware backend/src/services backend/src/utils backend/src/types backend/src/routes
mkdir -p frontend/src/api frontend/src/components frontend/src/hooks frontend/public

# --- ROOT INFRASTRUCTURE ---

cat <<EOF > firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
    function isOwner(userId) { return request.auth != null && request.auth.uid == userId; }
    match /users/{userId} {
      allow read: if isOwner(userId);
      match /journals/{id} { allow read: if isOwner(userId); allow write: if false; }
      match /conversations/{cId}/{document=**} { allow read: if isOwner(userId); allow write: if false; }
      match /idempotencyKeys/{key} { allow read, write: if false; }
      match /counters/{counter} { allow read, write: if false; }
      match /thoughtMap/{id} { allow read: if isOwner(userId); allow write: if false; }
    }
  }
}
EOF

cat <<EOF > Dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY . .
RUN cd frontend && npm install && npm run build
RUN cd backend && npm install && npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
LABEL dev-tutorial=cloud-run-ai-challenge
COPY --from=builder /app/backend/package*.json ./
RUN npm install --only=production
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/frontend/dist ./public
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
EOF

cat <<EOF > .dockerignore
node_modules
frontend/node_modules
backend/dist
frontend/dist
.env
.git
EOF

# --- BACKEND IMPLEMENTATION ---

cat <<EOF > backend/package.json
{
  "name": "journal-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn src/index.ts"
  },
  "dependencies": {
    "@google/generative-ai": "^0.11.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "firebase-admin": "^12.1.1",
    "helmet": "^7.1.0",
    "pino": "^9.1.0",
    "pino-http": "^10.1.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.12.12",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.4.5"
  }
}
EOF

cat <<EOF > backend/src/config/env.ts
import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

export const env = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.string().default('8080'),
  PROJECT_ID: z.string(),
  GEMINI_API_KEY: z.string(),
  GEMINI_MODEL_ID: z.string().default('gemini-3.8-flash'),
  FRONTEND_ORIGIN: z.string().url()
}).parse(process.env);
EOF

cat <<EOF > backend/src/utils/firebase.ts
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../config/env.js';

const app = getApps().length === 0 ? initializeApp({ projectId: env.PROJECT_ID }) : getApps()[0];
export const auth = getAuth(app);
export const db = getFirestore(app);
EOF

cat <<EOF > backend/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { auth } from '../utils/firebase.js';

export const authenticate = async (req: any, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = { uid: decoded.uid };
    next();
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
};
EOF

cat <<EOF > backend/src/services/chat.service.ts
import { db } from '../utils/firebase.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';

export class ChatService {
  static async lockConversation(uid: string, conversationId: string) {
    const convRef = db.collection('users').doc(uid).collection('conversations').doc(conversationId);
    const newToken = randomUUID();
    await db.runTransaction(async (t) => {
      const doc = await t.get(convRef);
      if (doc.exists && doc.data()?.isProcessing && doc.data()?.processingLeaseExpiresAt.toMillis() > Date.now()) {
        throw new Error('CONVERSATION_BUSY');
      }
      t.set(convRef, {
        status: 'ACTIVE',
        isProcessing: true,
        processingToken: newToken,
        processingLeaseExpiresAt: Timestamp.fromMillis(Date.now() + 60000),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    return newToken;
  }
}
EOF

# --- FRONTEND BOILERPLATE ---

cat <<EOF > frontend/package.json
{
  "name": "journal-frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "firebase": "^10.11.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.66",
    "@types/react-dom": "^18.2.22",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.2.2",
    "vite": "^5.2.0"
  }
}
EOF

echo "Initialization Script Created. Run 'bash hydrate.sh' to generate the files."