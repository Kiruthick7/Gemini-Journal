# Personal Gemini Journal

## Project Purpose
Personal Gemini Journal is a privacy-first, cloud-native AI journaling application. It allows users to have multi-turn conversations with Gemini, auto-summarizes those thoughts into structured journals, and securely discovers recurring patterns over time.

## Architecture Overview
This repository uses a clean monorepo structure.
- **Frontend**: React + TypeScript (Vite)
- **Backend**: Node.js + Express + TypeScript on Cloud Run
- **Database**: Cloud Firestore
- **Authentication**: Firebase Auth
- **AI**: Google Gemini API

The backend is strictly stateless and acts as the authoritative boundary for all database writes and AI invocations.

## Technology Stack
- **Node 20**
- **Express** (helmet, cors, pino-http)
- **Firebase Admin SDK**
- **Zod** (strict runtime validation)
- **Jest** (testing)
- **Docker**

## Repository Structure
```
/
├── frontend/             # React application (Phase 2)
├── backend/              # Node.js Cloud Run backend
│   ├── src/
│   │   ├── config/       # Environment loading (Zod)
│   │   ├── middleware/   # Auth, Error, Request-ID
│   │   ├── utils/        # Firebase Admin, Pino logger
│   │   ├── errors/       # Typed Application Errors
│   │   ├── types/        # TypeScript augmentations
│   │   ├── app.ts        # Express wiring
│   │   └── server.ts     # Entrypoint & graceful shutdown
│   ├── tests/            # Jest test suites
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── firestore.rules       # Strict default-deny rules
├── Dockerfile            # Multi-stage Cloud Run build
├── .dockerignore
└── README.md
```

## Security Principles & Firestore Authorization
- **Zero-Trust Client**: The browser cannot write to Firestore. All writes are mediated by the Cloud Run backend.
- **Identity Invariant**: The authenticated Firebase `req.user.uid` is the *only* trusted identity. Client-supplied IDs are never used for authorization.
- **Data Minimization**: Raw journal contents are never logged, and Thought Maps are generated using only minimized metadata signals.
- **Firestore Rules**: `firestore.rules` defaults to deny, explicitly allowing client reads (and constrained creates) only where mathematically bound to their `uid`.

## Cloud Run Deployment Overview
The backend is designed for Google Cloud Run:
- **Stateless**: Uses Firestore for durable state and distributed rate limiting.
- **Graceful Shutdown**: Listens to `SIGTERM` to drain active requests.
- **Labeling**: Deployed containers must carry the mandatory `dev-tutorial=cloud-run-ai-challenge` label.

## Local Development Prerequisites
1. Node 20
2. Firebase Project (with Firestore and Auth enabled)
3. Google Cloud Service Account (for local Firebase Admin access)

## Environment Configuration
Create a `.env` file in the `backend/` directory:
```
NODE_ENV=development
PORT=8080
FRONTEND_ORIGIN=http://localhost:5173
# For local dev only. Cloud Run uses Application Default Credentials automatically.
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

## Phase 4: Private Journal Search
The application now supports **Keyword Search** allowing users to query their past journals securely.
- **Privacy Model**: All search operations are strictly scoped to the authenticated `uid`. The backend constructs paths as `users/{uid}/journals`.
- **Query Understanding**: Gemini is selectively used to extract up to 8 normalized keywords from natural-language queries.
- **Firestore Integration**: To avoid unbounded scanning or external vector databases, search uses `array-contains-any` on existing `keywords` and `themes` fields, combined with local deterministic deduplication and ranking.
- **Quota**: Search requests are rate-limited to 30 queries per day via atomic Firestore quotas.

> **Note**: This feature is a bounded keyword search, not a semantic or vector database search.

## Testing
Run the tests from the backend directory:
```bash
cd backend
npm install
npm run test
```
