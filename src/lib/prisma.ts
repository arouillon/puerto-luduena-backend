import { PrismaClient } from '@prisma/client';

// Singleton para evitar múltiples conexiones en development
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Middleware global: soft delete filter
prisma.$use(async (params, next) => {
  // Modelos con soft delete
  const softDeleteModels = ['User', 'Vessel', 'Document'];

  if (softDeleteModels.includes(params.model ?? '')) {
    // findMany / findFirst: filtrar por deletedAt = null automáticamente
    if (params.action === 'findMany' || params.action === 'findFirst') {
      if (!params.args) params.args = {};
      if (!params.args.where) params.args.where = {};
      // Solo aplicar si no se especificó deletedAt explícitamente
      if (params.args.where.deletedAt === undefined) {
        params.args.where.deletedAt = null;
      }
    }

    // delete → convertir a update con deletedAt
    if (params.action === 'delete') {
      params.action = 'update';
      params.args.data = { deletedAt: new Date() };
    }
    if (params.action === 'deleteMany') {
      params.action = 'updateMany';
      if (!params.args) params.args = {};
      if (!params.args.data) params.args.data = {};
      params.args.data.deletedAt = new Date();
    }
  }

  return next(params);
});

export default prisma;
