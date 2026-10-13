// Seed the knowledge graph (domains/skills/prerequisites), a local learner, and the admin account.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { SKILLS, LOCAL_LEARNER_ID } from "../src/lib/seed-shared";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

async function main() {
  // Local learner (legacy seed row).
  await prisma.learner.upsert({
    where: { id: LOCAL_LEARNER_ID },
    update: {},
    create: { id: LOCAL_LEARNER_ID, name: "Learner" },
  });

  // Admin account: email "admin", password "admin".
  const admin = await prisma.user.upsert({
    where: { email: "admin" },
    update: { role: "admin" },
    create: {
      email: "admin",
      name: "Administrator",
      passwordHash: hashPassword("admin"),
      role: "admin",
    },
  });
  await prisma.learner.upsert({
    where: { id: admin.id },
    update: {},
    create: { id: admin.id, userId: admin.id, name: admin.name },
  });
  console.log(`Admin account ready (email: admin, password: admin).`);

  // Knowledge graph skills.
  for (const s of SKILLS) {
    await prisma.skill.upsert({
      where: { id: s.id },
      update: {
        name: s.name,
        description: s.description,
        domain: s.domain,
        category: s.category,
        difficulty: s.difficulty,
        cognitiveLevel: s.cognitiveLevel,
      },
      create: {
        id: s.id,
        name: s.name,
        description: s.description,
        domain: s.domain,
        category: s.category,
        difficulty: s.difficulty,
        cognitiveLevel: s.cognitiveLevel,
      },
    });
  }

  // Prerequisite edges.
  for (const s of SKILLS) {
    if (s.prerequisites.length === 0) continue;
    await prisma.skill.update({
      where: { id: s.id },
      data: { prerequisites: { connect: s.prerequisites.map((id) => ({ id })) } },
    });
  }

  const count = await prisma.skill.count();
  console.log(`Seeded ${count} skills.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
