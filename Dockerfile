FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS snapshots
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 dashboard && adduser --system --uid 1001 --ingroup dashboard dashboard
COPY lib ./lib
COPY scripts ./scripts
USER dashboard
CMD ["node", "--conditions=react-server", "--import", "tsx", "scripts/snapshot.ts", "--daemon"]

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build -- --webpack

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 dashboard && adduser --system --uid 1001 --ingroup dashboard dashboard
COPY --from=builder --chown=dashboard:dashboard /app/.next/standalone ./
COPY --from=builder --chown=dashboard:dashboard /app/.next/static ./.next/static
COPY --from=builder --chown=dashboard:dashboard /app/public ./public
USER dashboard
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
EXPOSE 3000
CMD ["node", "server.js"]
