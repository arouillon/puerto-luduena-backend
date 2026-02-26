import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';

export async function documentsRoutes(app: FastifyInstance) {

  // ─── POST /documents ─────────────────────────
  app.post('/documents', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { vesselId, type, label, fileUrl, fileType, expiresAt } = request.body as {
      vesselId: string;
      type: 'INSURANCE' | 'NAUTICAL_LICENSE' | 'TECHNICAL_REVIEW' | 'OTHER';
      label?: string;
      fileUrl: string;
      fileType: string;
      expiresAt: string;
    };

    // Verificar que es co-propietario
    const member = await prisma.vesselMember.findFirst({
      where: { vesselId, userId: request.user.sub, status: 'ACTIVE' },
    });
    if (!member && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'No sos co-propietario' });
    }

    const doc = await prisma.document.create({
      data: {
        vesselId,
        uploadedBy: request.user.sub,
        type,
        label,
        fileUrl,
        fileType,
        expiresAt: new Date(expiresAt),
      },
    });

    return reply.status(201).send(doc);
  });

  // ─── GET /vessels/:id/documents ──────────────
  app.get('/vessels/:id/documents', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{
    Params: { id: string };
  }>, reply: FastifyReply) => {
    const docs = await prisma.document.findMany({
      where: { vesselId: request.params.id },
      orderBy: { expiresAt: 'asc' },
    });

    return reply.send(docs);
  });

  // ─── GET /documents/expiring ─────────────────
  app.get('/documents/expiring', {
    preHandler: [app.requireRole('ADMIN', 'OPERATOR')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const config = await prisma.systemConfig.findUnique({ where: { key: 'DOC_EXPIRY_WARNING_DAYS' } });
    const warningDays = config ? parseInt(config.value) : 30;

    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + warningDays);

    const expiring = await prisma.document.findMany({
      where: {
        expiresAt: { lte: warningDate },
        status: { not: 'EXPIRED' },
      },
      include: {
        vessel: { select: { id: true, name: true, registration: true } },
      },
      orderBy: { expiresAt: 'asc' },
    });

    return reply.send(expiring);
  });

  // ─── PATCH /documents/:id ────────────────────
  app.patch('/documents/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{
    Params: { id: string };
    Body: { fileUrl?: string; expiresAt?: string; status?: string };
  }>, reply: FastifyReply) => {
    const doc = await prisma.document.findUnique({ where: { id: request.params.id } });
    if (!doc) return reply.status(404).send({ error: 'Documento no encontrado' });

    const body = request.body as { fileUrl?: string; expiresAt?: string; status?: string };
    const updateData: any = {};
    if (body.fileUrl) updateData.fileUrl = body.fileUrl;
    if (body.expiresAt) updateData.expiresAt = new Date(body.expiresAt);
    if (body.status) updateData.status = body.status;

    const updated = await prisma.document.update({
      where: { id: request.params.id },
      data: updateData,
    });

    return reply.send(updated);
  });
}
