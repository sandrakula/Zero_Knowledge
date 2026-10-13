// Seed the knowledge graph (domains/skills/prerequisites) and a local learner.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { SKILLS, LOCAL_LEARNER_ID } from "../src/lib/seed-shared";

const prisma = new PrismaClient();

async function main() {
  // Local learner (no auth in MVP).
  await prisma.learner.upsert({
    where: { id: LOCAL_LEARNER_ID },
    update: {},
    create: { id: LOCAL_LEARNER_ID, name: "Learner" },
  });

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
