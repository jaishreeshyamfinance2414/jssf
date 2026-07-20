#!/usr/bin/env bash
# One-shot dev bootstrap: migrate + seed the database.
set -e
cd "$(dirname "$0")/../backend"
npm run migrate
npm run seed
echo "DB ready. Start API: cd backend && npm run dev"
