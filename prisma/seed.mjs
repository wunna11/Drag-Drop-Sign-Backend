import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const orgName = process.env.SEED_ORG_NAME ?? "Demo Org";
  const plaintextKey = process.env.SEED_API_KEY_PLAINTEXT ?? "dev_live_replace_me";

  const org = await prisma.organization.create({
    data: { name: orgName },
  });

  const prefix = plaintextKey.slice(0, 8);
  const keyHash = await bcrypt.hash(plaintextKey, 12);

  await prisma.apiKey.create({
    data: {
      organizationId: org.id,
      name: "Development",
      keyPrefix: prefix,
      keyHash,
    },
  });



  console.log(`Seeded organization id: ${org.id}`);
  console.log(`API key (store securely; shown once): ${plaintextKey}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
