import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── ADMIN USER ──────────────────────────────
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@puertoludena.com' },
    update: {},
    create: {
      email: 'admin@puertoludena.com',
      passwordHash: adminPassword,
      firstName: 'Admin',
      lastName: 'Puerto Ludueña',
      role: 'ADMIN',
      isVerified: true,
      isActive: true,
    },
  });
  console.log('  ✓ Admin user created:', admin.email);

  // ─── OPERATOR ────────────────────────────────
  const opPassword = await bcrypt.hash('operador123', 12);
  const operator = await prisma.user.upsert({
    where: { email: 'operador@puertoludena.com' },
    update: {},
    create: {
      email: 'operador@puertoludena.com',
      passwordHash: opPassword,
      firstName: 'Carlos',
      lastName: 'Operador',
      role: 'OPERATOR',
      isVerified: true,
      isActive: true,
    },
  });
  console.log('  ✓ Operator user created:', operator.email);

  // ─── GATEKEEPER ──────────────────────────────
  const gkPassword = await bcrypt.hash('portero123', 12);
  const gatekeeper = await prisma.user.upsert({
    where: { email: 'portero@puertoludena.com' },
    update: {},
    create: {
      email: 'portero@puertoludena.com',
      passwordHash: gkPassword,
      firstName: 'Juan',
      lastName: 'Portero',
      role: 'GATEKEEPER',
      isVerified: true,
      isActive: true,
    },
  });
  console.log('  ✓ Gatekeeper user created:', gatekeeper.email);

  // ─── CLIENT ──────────────────────────────────
  const clientPassword = await bcrypt.hash('cliente123', 12);
  const client = await prisma.user.upsert({
    where: { email: 'marcos@ejemplo.com' },
    update: {},
    create: {
      email: 'marcos@ejemplo.com',
      passwordHash: clientPassword,
      firstName: 'Marcos',
      lastName: 'Fernández',
      dni: '30123456',
      role: 'CLIENT',
      isVerified: true,
      isActive: true,
    },
  });
  console.log('  ✓ Client user created:', client.email);

  // ─── CO-PROPIETARIO ──────────────────────────
  const client2Password = await bcrypt.hash('cliente123', 12);
  const client2 = await prisma.user.upsert({
    where: { email: 'valeria@ejemplo.com' },
    update: {},
    create: {
      email: 'valeria@ejemplo.com',
      passwordHash: client2Password,
      firstName: 'Valeria',
      lastName: 'Salas',
      dni: '32987654',
      role: 'CLIENT',
      isVerified: true,
      isActive: true,
    },
  });
  console.log('  ✓ Co-owner client created:', client2.email);

  // ─── VESSELS ─────────────────────────────────
  const vessel1 = await prisma.vessel.upsert({
    where: { registration: 'REG-001' },
    update: {},
    create: {
      name: 'El Tiburón',
      registration: 'REG-001',
      type: 'LANCHA',
      brand: 'Tracker',
      model: 'Trakker 520',
      year: 2020,
      berth: 'G1-C05',
      members: {
        create: [
          { userId: client.id, status: 'ACTIVE', acceptedAt: new Date() },
          { userId: client2.id, status: 'ACTIVE', acceptedAt: new Date() },
        ],
      },
    },
  });
  console.log('  ✓ Vessel created:', vessel1.name);

  const vessel2 = await prisma.vessel.upsert({
    where: { registration: 'REG-002' },
    update: {},
    create: {
      name: 'La Gaviota',
      registration: 'REG-002',
      type: 'VELERO',
      brand: 'Bermuda',
      year: 2018,
      berth: 'G2-C12',
      members: {
        create: [
          { userId: client.id, status: 'ACTIVE', acceptedAt: new Date() },
        ],
      },
    },
  });
  console.log('  ✓ Vessel created:', vessel2.name);

  // ─── SYSTEM CONFIG ───────────────────────────
  const configs = [
    { key: 'MIN_RESERVATION_MINUTES', value: '10', type: 'INT' as const, description: 'Minutos mínimos de anticipación para reservar' },
    { key: 'OPERATOR_ALERT_TIMEOUT_MINUTES', value: '3', type: 'INT' as const, description: 'Minutos para que un operador acepte antes de re-asignar' },
    { key: 'DOC_EXPIRY_WARNING_DAYS', value: '30', type: 'INT' as const, description: 'Días antes de vencimiento para alertar documentación' },
    { key: 'MAX_VESSEL_MEMBERS', value: '6', type: 'INT' as const, description: 'Máximo co-propietarios por embarcación' },
    { key: 'QR_VALIDITY_HOURS', value: '2', type: 'INT' as const, description: 'Horas de validez del QR de acceso' },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: {},
      create: { ...config, updatedBy: admin.id },
    });
  }
  console.log('  ✓ System config seeded');

  // ─── SAMPLE RESERVATION ──────────────────────
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  const returnTime = new Date(tomorrow);
  returnTime.setHours(18, 0, 0, 0);

  await prisma.reservation.create({
    data: {
      vesselId: vessel1.id,
      createdBy: client.id,
      status: 'CONFIRMED',
      estimatedArrival: tomorrow,
      estimatedReturn: returnTime,
      passengerCount: 3,
      navigationZone: 'Delta del Paraná - Zona Sur',
      notes: 'Salida familiar',
    },
  });
  console.log('  ✓ Sample reservation created');

  console.log('\n✅ Database seeded successfully!');
  console.log('\n📋 Credenciales de prueba:');
  console.log('  Admin:    admin@puertoludena.com / admin123');
  console.log('  Operador: operador@puertoludena.com / operador123');
  console.log('  Portero:  portero@puertoludena.com / portero123');
  console.log('  Cliente:  marcos@ejemplo.com / cliente123');
  console.log('  Cliente2: valeria@ejemplo.com / cliente123');
}

main()
  .catch(e => {
    console.error('❌ Error seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
