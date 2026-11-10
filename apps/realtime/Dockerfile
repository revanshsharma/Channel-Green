# Build from the repository root:  docker build -f apps/realtime/Dockerfile -t channel-green-realtime .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/realtime/package.json apps/realtime/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/content/package.json packages/content/
RUN npm ci
COPY packages packages
COPY apps/realtime apps/realtime
RUN npm run content:build && npm run build -w @channel-green/realtime

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/realtime/package.json apps/realtime/
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/content/package.json packages/content/
RUN npm ci --omit=dev --workspace @channel-green/realtime --include-workspace-root=false
COPY --from=build /app/apps/realtime/dist apps/realtime/dist
USER node
EXPOSE 4001
HEALTHCHECK CMD node -e "fetch('http://localhost:'+(process.env.PORT||4001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/realtime/dist/index.js"]
