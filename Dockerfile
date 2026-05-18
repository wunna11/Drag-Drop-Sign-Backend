# =========================================================================
# Stage 1: Build Stage
# =========================================================================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install native dependencies required for building some npm packages and prisma
RUN apk add --no-cache openssl libc6-compat

# Copy configuration and dependency manifest
COPY package*.json tsconfig.json ./

# Install all dependencies (including devDependencies for build step)
RUN npm ci

# Copy database schema first to generate Prisma Client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy the rest of the source code
COPY src ./src/
COPY public ./public/

# Compile TypeScript to dist/
RUN npm run build

# =========================================================================
# Stage 2: Production Stage
# =========================================================================
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

# Install runtime dependencies for Prisma Client
RUN apk add --no-cache openssl ca-certificates

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy compiled files, public assets, and prisma schemas from builder
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/public ./public
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /usr/src/app/node_modules/@prisma/client ./node_modules/@prisma/client

# Create directories for uploaded files and persistent volumes
RUN mkdir -p uploads && chown -R node:node /usr/src/app

# Setup dynamic entrypoint shell script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER node

EXPOSE 3000

ENV PORT=3000
ENV FILE_STORAGE_DIR="./uploads"

ENTRYPOINT ["./docker-entrypoint.sh"]
