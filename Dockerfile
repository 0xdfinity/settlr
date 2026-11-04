# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mcp/package.json apps/mcp/package.json
RUN npm ci --no-audit --no-fund

FROM base AS api-build
COPY . .
RUN npm run -w apps/api build && npm run -w apps/mcp build

FROM api-build AS api-runner
ENV NODE_ENV=production
EXPOSE 8787
CMD ["sh", "-c", "npm run -w apps/api migrate && npm run -w apps/api start"]

FROM base AS web-build
ARG NEXT_PUBLIC_API_URL=http://localhost:8787
ARG NEXT_PUBLIC_PAYPAL_CLIENT_ID=replace_with_non_secret_client_id
ARG NEXT_PUBLIC_PAYPAL_ENV=sandbox
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_PAYPAL_CLIENT_ID=$NEXT_PUBLIC_PAYPAL_CLIENT_ID
ENV NEXT_PUBLIC_PAYPAL_ENV=$NEXT_PUBLIC_PAYPAL_ENV
COPY . .
RUN npm run -w apps/web build

FROM node:22-bookworm-slim AS web-runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build /app/apps/web/public ./apps/web/public
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "server.js"]
