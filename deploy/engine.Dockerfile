# Engine service: estimate, search, full-report and MCP endpoints (engine/README.md).
# Build from the repository root: docker build -f deploy/engine.Dockerfile .
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 BID_ASSISTANT_DIR=/app/bid-assistant
WORKDIR /app/engine
COPY engine/package.json engine/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY engine/src ./src
# Only the runtime screening code and published reference packs; not research files or the local relay.
COPY bid-assistant/lib /app/bid-assistant/lib
COPY bid-assistant/packs /app/bid-assistant/packs
COPY bid-assistant/rules /app/bid-assistant/rules
COPY bid-assistant/data/data.js bid-assistant/data/regions.js /app/bid-assistant/data/
COPY bid-assistant/data/bundles /app/bid-assistant/data/bundles
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "src/server.js"]
