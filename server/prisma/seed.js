import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

const passwordHash = await bcrypt.hash(password, 10);

await prisma.admin.upsert({
  where: { email },
  update: { passwordHash },
  create: { email, passwordHash },
});

console.log(`Seeded admin user: ${email}`);

await prisma.$disconnect();
