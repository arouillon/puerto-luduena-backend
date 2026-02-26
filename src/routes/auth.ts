import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { registerSchema, loginSchema, refreshTokenSchema } from '../schemas/index.js';

export async function authRoutes(app: FastifyInstance) {

  // ─── POST /auth/register ─────────────────────
  app.post('/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: parsed.error.flatten() });
    }

    const { email, phone, password, firstName, lastName, dni } = parsed.data;

    // Verificar unicidad
    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return reply.status(409).send({ error: 'Email ya registrado' });
    }
    if (phone) {
      const existing = await prisma.user.findUnique({ where: { phone } });
      if (existing) return reply.status(409).send({ error: 'Teléfono ya registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        passwordHash,
        firstName,
        lastName,
        dni,
        role: 'CLIENT',
        isVerified: true, // Sin OTP por ahora, auto-verificado
      },
    });

    // Generar tokens
    const accessToken = app.jwt.sign({ sub: user.id, role: user.role, email: user.email ?? undefined });
    const refreshToken = crypto.randomUUID();
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
        deviceInfo: request.headers['user-agent'] ?? null,
      },
    });

    return reply.status(201).send({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      accessToken,
      refreshToken,
    });
  });

  // ─── POST /auth/login ────────────────────────
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: parsed.error.flatten() });
    }

    const { email, phone, password } = parsed.data;

    let user;
    if (email) {
      user = await prisma.user.findUnique({ where: { email } });
    } else if (phone) {
      user = await prisma.user.findUnique({ where: { phone } });
    }

    if (!user) {
      return reply.status(401).send({ error: 'Credenciales inválidas' });
    }

    if (!user.isActive) {
      return reply.status(403).send({ error: 'Cuenta suspendida. Contactá al administrador.' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'Credenciales inválidas' });
    }

    const accessToken = app.jwt.sign({ sub: user.id, role: user.role, email: user.email ?? undefined });
    const refreshToken = crypto.randomUUID();
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        deviceInfo: request.headers['user-agent'] ?? null,
      },
    });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      accessToken,
      refreshToken,
    });
  });

  // ─── POST /auth/refresh ──────────────────────
  app.post('/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = refreshTokenSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'refreshToken requerido' });
    }

    const { refreshToken } = parsed.data;
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const stored = await prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!stored || !stored.user.isActive) {
      return reply.status(401).send({ error: 'Token de refresco inválido o expirado' });
    }

    // Revocar el token anterior (rotación)
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    // Generar nuevos tokens
    const newAccessToken = app.jwt.sign({
      sub: stored.user.id,
      role: stored.user.role,
      email: stored.user.email ?? undefined,
    });
    const newRefreshToken = crypto.randomUUID();
    const newHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

    await prisma.refreshToken.create({
      data: {
        userId: stored.user.id,
        tokenHash: newHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        deviceInfo: request.headers['user-agent'] ?? null,
      },
    });

    return reply.send({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  });

  // ─── POST /auth/logout ───────────────────────
  app.post('/auth/logout', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Revocar todos los refresh tokens del usuario
    await prisma.refreshToken.updateMany({
      where: { userId: request.user.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return reply.send({ message: 'Sesión cerrada' });
  });
}
