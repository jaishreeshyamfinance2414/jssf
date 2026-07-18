# JAI SHREE SHYAM FINANCE (JSSF)

Production-grade **Loan Management System** replacing an Excel-based finance workflow.

Built as an enterprise ERP foundation: clean architecture, repository pattern, RBAC,
JWT + refresh-token auth, normalized PostgreSQL, and a premium Next.js dashboard.

## Monorepo layout

```
jssf/
├─ backend/     Express + TypeScript API (clean/hexagonal architecture)
├─ frontend/    Next.js 15 (App Router) + Tailwind + shadcn/ui + TanStack Query
├─ shared/      Types/contracts shared between FE & BE
├─ docs/        Architecture & module docs
└─ scripts/     DB migrate / seed helpers
```

## Modules (roadmap)

Auth · Dashboard · Users · Roles · Permissions · Areas · Customers · Loans ·
Loan Approval · Collections · Expenses · Salary · Reports · Settings · Audit Logs.

The **day-one runnable slice** ships: full DB schema for every module, security
hardened API, complete authentication (JWT + refresh + account lock + RBAC), the
Dashboard aggregation endpoints, and the login + dashboard UI.

## Quick start

### 1. Database
```bash
createdb jssf
cd backend
cp .env.example .env      # edit DATABASE_URL + secrets
npm install
npm run migrate           # applies backend/src/db/migrations/*.sql
npm run seed              # roles, permissions, settings, admin user
```

Default admin (change immediately): `admin@jssf.local` / mobile `9999999999` / `Admin@123`

Default collection agents:
- `agent1@jssf.local` / mobile `8888888881` / `Agent@123`
- `agent2@jssf.local` / mobile `8888888882` / `Agent@123`

Collection agents can view dashboard, customers, loans and collections; create customers
and loan applications; and record collections. They do not receive delete, approval,
disbursement, capital, settings, user-management, role-management, salary, expense,
report, or audit permissions.

### 2. Backend API
```bash
cd backend
npm run dev               # http://localhost:4000
```

### 3. Frontend
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev               # http://localhost:3000
```

## Architecture principles

- **Repository pattern** — modules never touch SQL directly; they call repositories.
- **Layered modules** — `routes → controller → service → repository`.
- **RBAC** — permissions are data, checked by middleware; roles map to permission sets.
- **Transactions** — money-moving operations (disbursement, collection) run in a single DB tx.
- **Audit everything** — create/update/login/approval/status changes are logged.
- **Future-ready** — `branch_id` columns and a settings table are present so Multi-Branch,
  Accounting, Notifications and Salary automation drop in without migrations that break data.
