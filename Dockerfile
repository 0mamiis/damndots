FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
RUN npm ci
RUN npm run typecheck
RUN npm run build --workspace @dots/dashboard

FROM build AS server
RUN npm install --global @openai/codex@0.159.2
RUN npx playwright install --with-deps chromium
ENV DOTS_HOST=0.0.0.0 DOTS_PORT=9340 DOTS_DATA_DIR=/data DOTS_TRUST_PROXY=1
EXPOSE 9340
VOLUME ["/data"]
CMD ["node","--import","tsx","scripts/container-server.ts"]

FROM build AS dashboard
ENV DOTS_DASHBOARD_HOST=0.0.0.0 DOTS_DASHBOARD_PORT=4320 DOTS_SERVER_URL=http://127.0.0.1:9340
EXPOSE 4320
CMD ["npm","run","start","--workspace","@dots/dashboard","--","--port","4320"]

FROM build AS worker
RUN npm install --global @openai/codex@0.159.2
RUN npx playwright install --with-deps chromium
VOLUME ["/workspace","/worker-data"]
ENV DOTS_WORKER_DATA_DIR=/worker-data
CMD ["node","--import","tsx","apps/worker/src/index.ts","--root","/workspace"]
