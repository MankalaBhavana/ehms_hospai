# Web app: builds the React apps, then serves them with the production Node server
# (static files, shared-data sync, API reverse proxy).
# Build from the repository root:  docker build -f deploy/web.Dockerfile -t ehms-web .

# ---- build the hospital app and the embedded OCR screens ----------------------------------------
FROM node:22-alpine AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY ocr-frontend/package.json ocr-frontend/package-lock.json ./ocr-frontend/
RUN cd ocr-frontend && npm ci --no-audit --no-fund
COPY frontend/ ./frontend/
COPY ocr-frontend/ ./ocr-frontend/
RUN cd frontend && npm run build && cd ../ocr-frontend && npm run build

# ---- runtime -------------------------------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production PORT=8443 DATA_DIR=/data
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /src/frontend/dist ./dist
COPY --from=build /src/ocr-frontend/dist /app/ocr-frontend/dist
COPY frontend/server ./server
RUN rm -rf ./server/data && mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8443
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8443/healthz || exit 1
CMD ["node", "server/prod.mjs"]
