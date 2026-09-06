#!/bin/bash

# Exit on any error
set -e

# Load environment variables (optional, assuming defaults below)
PROJECT_ID=${GOOGLE_CLOUD_PROJECT:-"YOUR_PROJECT_ID"}
REGION=${GOOGLE_CLOUD_REGION:-"us-central1"}
SERVICE_NAME="gemini-journal-backend"

echo "Deploying $SERVICE_NAME to Cloud Run in project $PROJECT_ID..."

# Deploy to Cloud Run
# 1. Source deployment implies Cloud Build will automatically build the Dockerfile.
# 2. Mandatory label: dev-tutorial=cloud-run-ai-challenge
# 3. Secret manager references for production configurations
gcloud run deploy $SERVICE_NAME \
  --source . \
  --project $PROJECT_ID \
  --region $REGION \
  --allow-unauthenticated \
  --labels="dev-tutorial=cloud-run-ai-challenge" \
  --set-env-vars="NODE_ENV=production,FIRESTORE_DATABASE_ID=coffee-menu" \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest" \
  --set-secrets="FIREBASE_PROJECT_ID=FIREBASE_PROJECT_ID:latest" \
  --set-secrets="FRONTEND_ORIGIN=FRONTEND_ORIGIN:latest" \
  --min-instances=0 \
  --max-instances=10 \
  --cpu=1 \
  --memory=512Mi

echo "Deployment complete."
