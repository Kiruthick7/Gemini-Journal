# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Stage 3: Runner Image
FROM node:20-alpine AS runner
WORKDIR /app/backend

# Set NODE_ENV
ENV NODE_ENV=production
ENV PORT=8080

# Install backend production dependencies
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy compiled backend source
COPY --from=backend-builder /app/backend/dist ./dist

# Copy compiled frontend source
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Run as non-root user
USER node

# Expose the Cloud Run port
EXPOSE 8080

# Start server
CMD ["node", "dist/server.js"]
