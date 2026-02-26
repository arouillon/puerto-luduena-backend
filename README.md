# Puerto Ludueña — Backend API

API REST para la gestión de guardería náutica Puerto Ludueña.

## Stack
- **Runtime:** Node.js 20+
- **Framework:** Fastify 5 + TypeScript
- **ORM:** Prisma 6 + PostgreSQL 16
- **Auth:** JWT (access + refresh tokens)
- **Validación:** Zod

## Estructura del proyecto
```
src/
├── server.ts          # Entry point
├── plugins/
│   └── auth.ts        # JWT plugin + role decorators
├── routes/
│   ├── auth.ts        # Register, login, refresh, logout
│   ├── users.ts       # Profile (GET/PATCH /users/me)
│   ├── vessels.ts     # CRUD embarcaciones + co-propietarios
│   ├── reservations.ts # CRUD reservas + validaciones
│   ├── access.ts      # Control de acceso (QR + manual)
│   ├── botado.ts      # Workflow de botado (operadores)
│   ├── notifications.ts # Inbox + broadcast
│   ├── authorizations.ts # Navegantes/técnicos autorizados
│   ├── documents.ts   # Documentación de embarcaciones
│   └── admin.ts       # Stats, users, config
├── schemas/
│   └── index.ts       # Validaciones Zod
└── lib/
    └── prisma.ts      # Prisma client singleton + soft delete
```

## Endpoints principales

| Módulo | Endpoints | Auth |
|--------|-----------|------|
| Auth | POST /auth/register, /login, /refresh, /logout | Público (excepto logout) |
| Users | GET/PATCH /users/me, GET /users/:id | JWT |
| Vessels | GET/POST/PATCH /vessels, members mgmt | JWT |
| Reservations | GET/POST/PATCH/DELETE /reservations | JWT |
| Access | POST /access/manual, /access/scan, /access/inside | GATEKEEPER+ |
| Botado | POST /botado/accept, PATCH /botado/:id/launched | OPERATOR+ |
| Notifications | GET /notifications/me, POST broadcast | JWT / ADMIN |
| Authorizations | POST/GET/DELETE /authorizations | JWT |
| Documents | POST/GET/PATCH /documents | JWT |
| Admin | GET /admin/stats, /admin/users, /admin/config | ADMIN |

## Setup local

```bash
# 1. Clonar e instalar
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tu DATABASE_URL y JWT_SECRET

# 3. Crear base de datos y ejecutar migraciones
npx prisma migrate dev

# 4. Seed con datos de prueba
npm run db:seed

# 5. Iniciar en desarrollo
npm run dev
```

## Credenciales de prueba (después del seed)
| Rol | Email | Password |
|-----|-------|----------|
| Admin | admin@puertoludena.com | admin123 |
| Operador | operador@puertoludena.com | operador123 |
| Portero | portero@puertoludena.com | portero123 |
| Cliente | marcos@ejemplo.com | cliente123 |

## Deploy en Railway

1. Crear cuenta en [railway.com](https://railway.com)
2. Nuevo proyecto → "Deploy from GitHub repo"
3. Conectar repositorio
4. Agregar servicio PostgreSQL al proyecto
5. Configurar variables de entorno (ver .env.example)
6. Railway despliega automáticamente en cada push a `main`

## Reglas de negocio implementadas
- ✅ Conflicto de reservas (mismo barco, mismo día)
- ✅ Restricción por documentación (hasRestriction)
- ✅ Membresía activa requerida para reservar
- ✅ Anticipación mínima configurable
- ✅ Race condition en dispatch de operadores (unique constraint)
- ✅ Fan-out de notificaciones a co-propietarios
- ✅ Soft delete global (middleware Prisma)
- ✅ Límite de co-propietarios configurable
