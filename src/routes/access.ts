import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { manualAccessSchema, paginationSchema } from '../schemas/index.js';

export async function accessRoutes(app: FastifyInstance) {

  // ─── POST /access/manual (ingreso manual por portero) ──
  app.post('/access/manual', {
    preHandler: [app.requireRole('GATEKEEPER', 'ADMIN')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = manualAccessSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: parsed.error.flatten() });
    }

    const { personName, personDoc, vesselId, notes, direction } = parsed.data;

    const log = await prisma.accessLog.create({
      data: {
        gatekeeperId: request.user.sub,
        personName,
        personDoc,
        vesselId,
        accessType: 'MANUAL',
        direction,
        notes,
      },
      include: {
        vessel: { select: { id: true, name: true, registration: true } },
      },
    });

    return reply.status(201).send(log);
  });

  // ─── POST /access/scan (escaneo de QR) ──────
  app.post('/access/scan', {
    preHandler: [app.requireRole('GATEKEEPER', 'ADMIN')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { qrToken } = request.body as { qrToken: string };

    if (!qrToken) {
      return reply.status(400).send({ error: 'Token QR requerido' });
    }

    // Verificar JWT del QR
    let decoded: { reservationId: string; vesselId: string; userId: string };
    try {
      decoded = app.jwt.verify<{ reservationId: string; vesselId: string; userId: string }>(qrToken);
    } catch {
      return reply.status(401).send({ error: 'QR inválido o expirado' });
    }

    // Buscar reserva
    const reservation = await prisma.reservation.findUnique({
      where: { id: decoded.reservationId },
      include: {
        vessel: true,
        creator: { select: { id: true, firstName: true, lastName: true, dni: true } },
      },
    });

    if (!reservation || reservation.status === 'CANCELLED') {
      return reply.status(404).send({ error: 'Reserva no encontrada o cancelada' });
    }

    // Registrar ingreso
    const log = await prisma.accessLog.create({
      data: {
        gatekeeperId: request.user.sub,
        personName: `${reservation.creator.firstName} ${reservation.creator.lastName}`,
        personDoc: reservation.creator.dni,
        userId: reservation.creator.id,
        vesselId: reservation.vesselId,
        reservationId: reservation.id,
        accessType: 'QR_RESERVATION',
        direction: 'ENTRY',
      },
    });

    // Si la reserva estaba CONFIRMED, notificar operadores
    if (reservation.status === 'CONFIRMED') {
      // TODO: Socket.io emit a room 'operators' cuando se implemente WebSocket
    }

    return reply.status(201).send({
      access: log,
      reservation: {
        id: reservation.id,
        status: reservation.status,
        vessel: reservation.vessel,
        creator: reservation.creator,
      },
    });
  });

  // ─── PATCH /access/:id/exit ──────────────────
  app.patch('/access/:id/exit', {
    preHandler: [app.requireRole('GATEKEEPER', 'ADMIN')],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const log = await prisma.accessLog.findUnique({ where: { id: request.params.id } });
    if (!log) return reply.status(404).send({ error: 'Registro de acceso no encontrado' });
    if (log.exitedAt) return reply.status(400).send({ error: 'Ya se registró el egreso' });

    const updated = await prisma.accessLog.update({
      where: { id: request.params.id },
      data: { exitedAt: new Date() },
    });

    return reply.send(updated);
  });

  // ─── GET /access/inside (personas dentro del predio) ──
  app.get('/access/inside', {
    preHandler: [app.requireRole('GATEKEEPER', 'OPERATOR', 'ADMIN')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const inside = await prisma.accessLog.findMany({
      where: {
        direction: 'ENTRY',
        exitedAt: null,
      },
      include: {
        vessel: { select: { id: true, name: true, registration: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { enteredAt: 'desc' },
    });

    return reply.send(inside);
  });

  // ─── GET /access/log (historial) ─────────────
  app.get('/access/log', {
    preHandler: [app.requireRole('GATEKEEPER', 'OPERATOR', 'ADMIN')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { page, limit } = paginationSchema.parse(request.query);

    const [logs, total] = await Promise.all([
      prisma.accessLog.findMany({
        include: {
          vessel: { select: { id: true, name: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
          gatekeeper: { select: { id: true, firstName: true, lastName: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { enteredAt: 'desc' },
      }),
      prisma.accessLog.count(),
    ]);

    return reply.send({ data: logs, total, page, limit });
  });
}
