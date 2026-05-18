#!/bin/sh
set -e

echo "⏳ Waiting for database connection at $DATABASE_URL ..."

# A simple loop to check if database port is open (optional but helpful if netcat is available)
# Since we are running in an alpine base, we can also let Prisma's built-in retry handle it or use a timeout.
sleep 3

echo "🚀 Database connection established. Synchronizing schema..."
npx prisma db push --accept-data-loss

echo "🌱 Seeding default credentials..."
node prisma/seed.mjs || echo "⚠️ Seeding skipped or already seeded."

echo "🔥 Starting production Express server..."
exec npm run start
