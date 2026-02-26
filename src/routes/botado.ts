import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';

export async function botadoRoutes(app: FastifyInstance) {

  // ─── POST /botado/accept ─────────────────────
  // Operador acepta un botado. Race condition protegida con unique constraint.
  app.post('/botado/accept', {
    preHandler: [app.requireRole('OPERATOR', 'ADMIN')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { reservationId } = request.body as { reservationId: string };

    if (!reservationId) {
      return reply.status(400).send({ error: 'reservationId requerido' });
    }

    const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation) return reply.status(404).send({ error: 'Reserva no encontrada' });
    if (reservation.status !== 'CONFIRMED') {
      return reply.status(400).send({ error: `Reserva en estado ${reservation.status}, no se puede aceptar` });
    }

    // Race condition: intentar insertar. Si ya existe, falla por unique constraint.
    try {
      const botado = await prisma.botadoEvent.create({
        data: {
          reservationId,
          operatorId: request.user.sub,
          alertSentAt: new Date(), // En un sistema real, esto vendría del evento anterior
          acceptedAt: new Date(),
        },
      });

      return reply.status(201).send(botado);
    } catch (error: any) {
      if (error.code === 'P2002') {
        // Unique constraint violation — otro operador ya aceptó
        return reply.status(409).send({ error: 'Este botado ya fue tomado por otro operador' });
      }
      throw error;
    }
  });

  // ─── PATCH /botado/:id/launched ──────────────
  // Operador marca que la embarcación fue botada al agua
  app.patch('/botado/:id/launched', {
    preHandler: [app.requireRole('OPERATOR', 'ADMIN')],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const botado = await prisma.botadoEvent.findUnique({
      where: { id: request.params.id },
      include: { reservation: true },
    });

    if (!botado) return reply.status(404).send({ error: 'Botado no encontrado' });
    if (botado.launchedAt) return reply.status(400).send({ error: 'Ya fue marcado como botado' });

    const responseTimeSec = Math.round((Date.now() - botado.acceptedAt.getTime()) / 1000);

    const [updated] = await Promise.all([
      prisma.botadoEvent.update({
        where: { id: request.params.id },
        data: { launchedAt: new Date(), responseTimeSec },
      }),
      prisma.reservation.update({
        where: { id: botado.reservationId },
        data: { status: 'IN_WATER' },
      }),
    ]);

    // Notificar al creador de la reserva
    await prisma.notification.create({
      data: {
        userId: botado.reservation.createdBy,
        type: 'VESSEL_LAUNCHED',
        title: 'Embarcación en el agua',
        body: 'Tu embarcación fue botada exitosamente',
        data: { reservationId: botado.reservationId },
      },
    });

    return reply.send(updated);
  });
}
