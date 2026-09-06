#!/bin/bash

# Create Folder Structure
mkdir -p backend/src/config backend/src/middleware backend/src/services backend/src/utils backend/src/types
mkdir -p frontend/src/api frontend/src/components frontend/src/hooks

# --- INFRASTRUCTURE FILES ---

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

# --- BACKEND CORE ---

cat <<EOF > backend/src/config/env.ts
import { z } from 'zod';
export const env = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.string().default('8080'),
  PROJECT_ID: z.string(),
  GEMINI_API_KEY: z.string(),
  GEMINI_MODEL_ID: z.string().default('gemini-3.8-flash'),
  FRONTEND_ORIGIN: z.string().url()
}).parse(process.env);
EOF

# (Additional backend logic for Chat, Journal, and Thought Map would go here)

echo "Project structure and core configuration files created."
