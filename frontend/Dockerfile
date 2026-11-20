FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace frontend --include-workspace-root
COPY frontend frontend
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w frontend

FROM build AS runtime
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "frontend", "--", "--hostname", "0.0.0.0"]
