import { PrismaClient } from '@prisma/client';
import './loadRootEnv.js';

export const prisma = new PrismaClient();
