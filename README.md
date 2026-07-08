# MerchOS

Multi-tenant marketplace product management platform. MerchOS helps sellers manage products through their full lifecycle — from ingestion and enrichment to compliance validation and multi-channel publishing.

## Architecture

MerchOS is a monorepo containing two frontend applications and shared packages:

```
MerchOS/
├── apps/
│   ├── seller-dashboard/    # Seller-facing SPA (Next.js 14)
│   └── admin-dashboard/     # Internal operator dashboard (Next.js 14)
├── packages/
│   ├── types/               # Shared TypeScript types
│   ├── auth/                # Cognito authentication wrapper
│   ├── api-client/          # React Query hooks + HTTP client
│   └── ui/                  # Shared component library (Radix UI + Tailwind)
├── services/                # Backend services (Lambda, Step Functions)
└── infrastructure/          # AWS CDK infrastructure
```

## Applications

### Seller Dashboard (`apps/seller-dashboard`)

Customer-facing application for sellers to manage their products, inventory, billing, channels, and team.

- **URL**: Deployed on AWS Amplify
- **Port**: 3000 (local dev)
- **Auth**: Cognito Tenant Pool (PKCE + optional MFA)
- **Roles**: viewer, editor, admin, owner

**Features:**
- Product catalog with lifecycle management
- Image management with moderation
- Inventory tracking and stock adjustments
- Billing and subscription management
- Channel integrations (Takealot, Amazon, Shopify, etc.)
- Team management with role-based access
- Real-time notifications via WebSocket
- CSV import/export

### Admin Dashboard (`apps/admin-dashboard`)

Internal tool for MerchOS platform operators to monitor and manage the platform.

- **URL**: Deployed on AWS Amplify (separate app)
- **Port**: 3001 (local dev)
- **Auth**: Admin Cognito Pool (PKCE + mandatory TOTP MFA)
- **Role**: operator (single role)

**Features:**
- Platform health monitoring (Lambda, Step Functions, SQS, DynamoDB metrics)
- Tenant management (view, suspend, activate)
- Compliance rule editor (per-channel JSON schema forms)
- Taxonomy management with refresh triggers
- Audit log viewer with search and filters
- Alert dashboard with resolution tracking
- Billing administration with plan overrides

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5.4 |
| Styling | Tailwind CSS 3.4 |
| State (server) | TanStack Query v5 |
| State (client) | Zustand |
| Components | Radix UI primitives |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| Auth | AWS Amplify Auth (Cognito) |
| HTTP | Axios |
| Monorepo | Turborepo |
| Infrastructure | AWS CDK |
| Hosting | AWS Amplify Gen 2 |

## Getting Started

### Prerequisites

- Node.js >= 20
- npm >= 10

### Installation

```bash
npm install
```

### Development

```bash
# Run seller dashboard
npm run dev --workspace=@merch-os/seller-dashboard

# Run admin dashboard
npm run dev --workspace=@merch-os/admin-dashboard

# Run both
npx turbo run dev
```

### Build

```bash
# Build all
npm run build

# Build specific app
npm run build --workspace=@merch-os/seller-dashboard
```

### Type Checking

```bash
npm run typecheck
```

## Environment Variables

### Seller Dashboard

```env
NEXT_PUBLIC_COGNITO_USER_POOL_ID=
NEXT_PUBLIC_COGNITO_CLIENT_ID=
NEXT_PUBLIC_COGNITO_DOMAIN=
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_WS_URL=
```

### Admin Dashboard

```env
NEXT_PUBLIC_ADMIN_COGNITO_USER_POOL_ID=
NEXT_PUBLIC_ADMIN_COGNITO_CLIENT_ID=
NEXT_PUBLIC_ADMIN_COGNITO_DOMAIN=
NEXT_PUBLIC_API_BASE_URL=
```

## Deployment

Both apps deploy independently on AWS Amplify Gen 2. Each app has its own Amplify application connected to the same GitHub repo with different monorepo root directories:

- Seller Dashboard: `apps/seller-dashboard`
- Admin Dashboard: `apps/admin-dashboard`

## License

Private — All rights reserved.
