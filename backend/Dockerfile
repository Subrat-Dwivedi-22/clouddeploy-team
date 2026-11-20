FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/prisma.config.ts
RUN npm ci --workspace backend --include-workspace-root
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
RUN npm run generate -w backend && npm run build -w backend

FROM build AS runtime
RUN npm prune --omit=dev --workspace backend --include-workspace-root
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app/backend
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
