# SDR Command Center

A React web application for monitoring and controlling software-defined radio devices.

## Features

- **Keycloak Authentication** - OIDC-based login with role-based access control
- **Customizable Dashboards** - Drag/drop widgets with layout persistence
- **Device Inventory** - Monitor and control SDR devices
- **Map View** - OpenStreetMap integration via MapLibre GL
- **Spectrum Lab** - Live spectrum analysis with multi-device overlay
- **Raw Lab** - Capture and analysis workflows (role-gated)

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui
- **Auth**: Keycloak OIDC
- **Maps**: MapLibre GL (OpenStreetMap)
- **Charts**: Canvas-based spectrum rendering

## Getting Started

### Prerequisites

- Node.js 18+
- npm or bun
- Docker (for Keycloak)

### Installation

```bash
# Clone the repository
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start the development server
npm run dev
```

## Keycloak Setup

### 1. Run Keycloak with Docker

```bash
docker run -d \
  --name keycloak \
  -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin \
  -e KEYCLOAK_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:latest \
  start-dev
```

### 2. Configure Keycloak

1. Open Keycloak Admin Console: http://localhost:8080
2. Login with `admin` / `admin`

#### Create Realm
1. Click "Create Realm"
2. Name: `sdr`
3. Click "Create"

#### Create Client
1. Go to Clients → Create client
2. Client ID: `lovable-web`
3. Client type: `OpenID Connect`
4. Click "Next"
5. Client authentication: `OFF` (public client)
6. Authorization: `OFF`
7. Click "Next"
8. Valid redirect URIs: `http://localhost:5173/*`
9. Web origins: `http://localhost:5173`
10. Click "Save"

#### Create Roles
1. Go to Realm roles → Create role
2. Create these roles:
   - `ADMIN`
   - `ANALYST`
   - `VIEWER`

#### Create Test Users
1. Go to Users → Add user
2. Create users and assign roles:
   - `admin-user` → ADMIN, ANALYST, VIEWER
   - `analyst-user` → ANALYST, VIEWER
   - `viewer-user` → VIEWER
3. Set password in Credentials tab (disable "Temporary")

### 3. Configure Environment

Update your `.env` file:

```env
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=sdr
VITE_KEYCLOAK_CLIENT_ID=lovable-web
VITE_MOCK_AUTH=false
```

### 4. Development without Keycloak

For development without a Keycloak server, enable mock authentication:

```env
VITE_MOCK_AUTH=true
```

This provides a mock admin user with all roles.

## Role-Based Access

| Role     | Access                                      |
|----------|---------------------------------------------|
| VIEWER   | Dashboard, Devices, Map                     |
| ANALYST  | + Spectrum Lab, Raw Lab                     |
| ADMIN    | + Admin Panel                               |

## Project Structure

```
src/
├── api/           # API clients and HTTP helpers
├── auth/          # Keycloak integration and guards
│   ├── keycloak.ts      # Keycloak initialization
│   ├── AuthProvider.tsx # Auth context with token refresh
│   ├── RequireAuth.tsx  # Authentication guard
│   └── RequireRole.tsx  # Role-based access guard
├── components/    # UI components and widgets
├── pages/         # Route pages
├── models/        # TypeScript types
└── realtime/      # WebSocket client
```

## API Authentication

The `src/api/http.ts` module provides authenticated fetch helpers:

```typescript
import { http } from '@/api/http';

// Authenticated requests
const data = await http.get('/api/devices');
const result = await http.post('/api/captures', { deviceId, seconds: 5 });
```

## Environment Variables

| Variable                    | Description                          | Default                |
|-----------------------------|--------------------------------------|------------------------|
| `VITE_KEYCLOAK_URL`         | Keycloak server URL                  | http://localhost:8080  |
| `VITE_KEYCLOAK_REALM`       | Keycloak realm name                  | sdr                    |
| `VITE_KEYCLOAK_CLIENT_ID`   | Keycloak client ID                   | lovable-web            |
| `VITE_KEYCLOAK_REDIRECT_URI`| Override redirect URI (optional)     | window.location.origin |
| `VITE_API_BASE_URL`         | Backend API base URL                 | http://localhost:8090  |
| `VITE_WS_BASE_URL`          | WebSocket base URL                   | ws://localhost:8090    |
| `VITE_MOCK_AUTH`            | Enable mock authentication           | false                  |
| `VITE_MOCK_API`             | Enable mock API data                 | false                  |

## License

MIT
