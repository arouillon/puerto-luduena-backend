import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { Role } from '@prisma/client';

// Extend Fastify types
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: Role;
      email?: string;
    };
    user: {
      sub: string;
      role: Role;
      email?: string;
    };
  }
}

export async function authPlugin(app: FastifyInstance) {
  app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    sign: {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    },
  });

  // Decorator: authenticate (verifica JWT válido)
  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Token inválido o expirado' });
    }
  });

  // Decorator: requireRole (verifica que el usuario tenga uno de los roles)
  app.decorate('requireRole', function (...roles: Role[]) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
        if (!roles.includes(request.user.role)) {
          reply.status(403).send({ error: 'No tenés permisos para esta acción' });
        }
      } catch (err) {
        reply.status(401).send({ error: 'Token inválido o expirado' });
      }
    };
  });
}

// Extend Fastify instance type
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
