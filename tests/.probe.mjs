import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
try {
  console.log("DB_OK users=" + (await prisma.user.count()));
} catch (error) {
  console.log("DB_FAIL: " + String(error.message).split("\n")[0]);
}
await prisma.$disconnect();
