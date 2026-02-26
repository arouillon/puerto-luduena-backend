import { z } from 'zod';

// ─── AUTH ───────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email('Email inválido').optional(),
  phone: z.string().regex(/^\+\d{10,15}$/, 'Formato E.164 requerido (ej: +5493412345678)').optional(),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  firstName: z.string().min(1, 'Nombre requerido').max(100),
  lastName: z.string().min(1, 'Apellido requerido').max(100),
  dni: z.string().optional(),
}).refine(data => data.email || data.phone, {
  message: 'Se requiere al menos email o teléfono',
});

export const loginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string().min(1),
}).refine(data => data.email || data.phone, {
  message: 'Se requiere email o teléfono',
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── USERS ──────────────────────────────────────

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  dni: z.string().optional(),
  phone: z.string().regex(/^\+\d{10,15}$/).optional(),
});

// ─── VESSELS ────────────────────────────────────

export const createVesselSchema = z.object({
  name: z.string().min(1, 'Nombre requerido').max(200),
  registration: z.string().min(1, 'Matrícula requerida'),
  type: z.enum(['LANCHA', 'VELERO', 'KAYAK', 'OTHER']),
  brand: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1900).max(2030).optional(),
  berth: z.string().optional(),
  mooringZone: z.string().optional(),
});

export const updateVesselSchema = createVesselSchema.partial();

// ─── RESERVATIONS ───────────────────────────────

export const createReservationSchema = z.object({
  vesselId: z.string().uuid(),
  estimatedArrival: z.string().datetime({ message: 'Formato ISO 8601 requerido' }),
  estimatedReturn: z.string().datetime({ message: 'Formato ISO 8601 requerido' }),
  passengerCount: z.number().int().min(1).max(50).default(1),
  navigationZone: z.string().optional(),
  notes: z.string().max(500).optional(),
  authorizationId: z.string().uuid().optional(),
});

export const updateReservationStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'IN_WATER', 'RETURNED', 'CANCELLED']),
});

// ─── ACCESS LOG ─────────────────────────────────

export const manualAccessSchema = z.object({
  personName: z.string().min(1),
  personDoc: z.string().optional(),
  vesselId: z.string().uuid().optional(),
  notes: z.string().optional(),
  direction: z.enum(['ENTRY', 'EXIT']).default('ENTRY'),
});

export const scanAccessSchema = z.object({
  qrToken: z.string().min(1),
});

// ─── AUTHORIZATIONS ─────────────────────────────

export const createAuthorizationSchema = z.object({
  vesselId: z.string().uuid(),
  granteeName: z.string().min(1),
  granteeEmail: z.string().email().optional(),
  granteePhone: z.string().optional(),
  type: z.enum(['NAVIGATOR', 'TECHNICIAN']),
  purpose: z.string().optional(),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime(),
});

// ─── NOTIFICATIONS ──────────────────────────────

export const broadcastSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(1000),
});

// ─── ADMIN ──────────────────────────────────────

export const updateConfigSchema = z.object({
  value: z.string(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(['CLIENT', 'GATEKEEPER', 'OPERATOR', 'ADMIN']),
  isActive: z.boolean().optional(),
});

// ─── PAGINATION ─────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── TYPE EXPORTS ───────────────────────────────

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateVesselInput = z.infer<typeof createVesselSchema>;
export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type CreateAuthorizationInput = z.infer<typeof createAuthorizationSchema>;
