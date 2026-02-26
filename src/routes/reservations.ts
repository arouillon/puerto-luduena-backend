import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { createReservationSchema, paginationSchema } from '../schemas/index.js';

export async function reservationsRoutes(app: FastifyInstance) {

  // ─── GET /reservations ───────────────────────
  app.get('/reservations', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { page, limit } = paginationSchema.parse(request.query);
    const isAdmin = request.user.role === 'ADMIN';
    const isOperator = request.user.role === 'OPERATOR';

    let where: any = {};

    if (!isAdmin && !isOperator) {
      // Cliente: solo ve sus reservas
      where = { createdBy: request.user.sub };
    }

    const [reservations, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        include: {
          vessel: { select: { id: true, name: true, registration: true, berth: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          botadoEvent: { select: { id: true, operatorId: true, acceptedAt: true, launchedAt: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { estimatedArrival: 'desc' },
      }),
      prisma.reservation.count({ where }),
    ]);

    return reply.send({ data: reservations, total, page, limit });
  });

  // ─── GET /reservations/today ─────────────────
  app.get('/reservations/today', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const reservations = await prisma.reservation.findMany({
      where: {
        estimatedArrival: { gte: today, lt: tomorrow },
        status: { in: ['PENDING', 'CONFIRMED', 'IN_WATER'] },
      },
      include: {
        vessel: { select: { id: true, name: true, registration: true, berth: true, type: true } },
        creator: { select: { id: true, firstName: true, lastName: true, phone: true } },
        botadoEvent: true,
      },
      orderBy: { estimatedArrival: 'asc' },
    });

    return reply.send(reservations);
  });

  // ─── POST /reservations ──────────────────────
  app.post('/reservations', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createReservationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: parsed.error.flatten() });
    }

    const { vesselId, estimatedArrival, estimatedReturn, passengerCount, navigationZone, notes, authorizationId } = parsed.data;
    const arrivalDate = new Date(estimatedArrival);
    const returnDate = new Date(estimatedReturn);

    // ── Regla: Membresía activa ──
    const member = await prisma.vesselMember.findFirst({
      where: { vesselId, userId: request.user.sub, status: 'ACTIVE' },
    });
    // Si no es miembro, verificar autorización
    if (!member && !authorizationId) {
      return reply.status(403).send({ error: 'No sos co-propietario de esta embarcación ni tenés autorización' });
    }

    // ── Regla: Restricción de embarcación ──
    const vessel = await prisma.vessel.findUnique({ where: { id: vesselId } });
    if (!vessel) return reply.status(404).send({ error: 'Embarcación no encontrada' });
    if (vessel.hasRestriction) {
      return reply.status(403).send({
        error: 'Embarcación con restricción',
        detail: vessel.restrictionNote ?? 'Documentación vencida o problema pendiente',
      });
    }

    // ── Regla: Anticipación mínima ──
    const config = await prisma.systemConfig.findUnique({ where: { key: 'MIN_RESERVATION_MINUTES' } });
    const minMinutes = config ? parseInt(config.value) : 10;
    const minArrival = new Date(Date.now() + minMinutes * 60 * 1000);
    if (arrivalDate < minArrival) {
      return reply.status(400).send({ error: `La llegada debe ser al menos ${minMinutes} minutos en el futuro` });
    }

    // ── Regla: Conflicto de reservas ──
    const dayStart = new Date(arrivalDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const conflicting = await prisma.reservation.findFirst({
      where: {
        vesselId,
        status: { in: ['PENDING', 'CONFIRMED', 'IN_WATER'] },
        estimatedArrival: { gte: dayStart, lt: dayEnd },
      },
    });

    if (conflicting) {
      return reply.status(409).send({
        error: 'Ya existe una reserva activa para esta embarcación en el mismo día',
        conflictingReservation: {
          id: conflicting.id,
          status: conflicting.status,
          estimatedArrival: conflicting.estimatedArrival,
        },
      });
    }

    // ── Crear reserva ──
    const reservation = await prisma.reservation.create({
      data: {
        vesselId,
        createdBy: request.user.sub,
        authorizationId,
        estimatedArrival: arrivalDate,
        estimatedReturn: returnDate,
        passengerCount,
        navigationZone,
        notes,
        status: 'CONFIRMED', // Auto-confirmada en MVP
      },
      include: {
        vessel: { select: { id: true, name: true, registration: true, berth: true } },
      },
    });

    // Fan-out: notificar a todos los co-propietarios
    const activeMembers = await prisma.vesselMember.findMany({
      where: { vesselId, status: 'ACTIVE' },
    });

    await prisma.notification.createMany({
      data: activeMembers.map(m => ({
        userId: m.userId,
        type: 'RESERVATION_CONFIRMED' as const,
        title: 'Nueva reserva confirmada',
        body: `${vessel.name} tiene reserva para hoy a las ${arrivalDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`,
        data: { reservationId: reservation.id },
      })),
    });

    return reply.status(201).send(reservation);
  });

  // ─── PATCH /reservations/:id ─────────────────
  app.patch('/reservations/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{
    Params: { id: string };
    Body: { status: string };
  }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { status } = request.body as { status: string };

    const reservation = await prisma.reservation.findUnique({ where: { id } });
    if (!reservation) return reply.status(404).send({ error: 'Reserva no encontrada' });

    // Validar transiciones de estado
    const validTransitions: Record<string, string[]> = {
      PENDING: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['IN_WATER', 'CANCELLED'],
      IN_WATER: ['RETURNED'],
    };

    const allowed = validTransitions[reservation.status] ?? [];
    if (!allowed.includes(status)) {
      return reply.status(400).send({
        error: `No se puede cambiar de ${reservation.status} a ${status}`,
        allowedTransitions: allowed,
      });
    }

    const updateData: any = { status };
    if (status === 'CANCELLED') {
      updateData.cancelledAt = new Date();
      updateData.cancelledBy = request.user.sub;
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: updateData,
      include: { vessel: { select: { id: true, name: true } } },
    });

    return reply.send(updated);
  });

  // ─── DELETE /reservations/:id ────────────────
  app.delete('/reservations/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{
    Params: { id: string };
  }>, reply: FastifyReply) => {
    const reservation = await prisma.reservation.findUnique({ where: { id: request.params.id } });
    if (!reservation) return reply.status(404).send({ error: 'Reserva no encontrada' });

    if (!['PENDING', 'CONFIRMED'].includes(reservation.status)) {
      return reply.status(400).send({ error: 'Solo se pueden cancelar reservas pendientes o confirmadas' });
    }

    await prisma.reservation.update({
      where: { id: request.params.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: request.user.sub },
    });

    return reply.send({ message: 'Reserva cancelada' });
  });
}
