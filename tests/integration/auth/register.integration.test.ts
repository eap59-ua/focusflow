import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { EmailAlreadyRegisteredError } from "@/domain/user/errors/EmailAlreadyRegisteredError";
import { buildContainer, type Container } from "@/infrastructure/container";

let prisma: PrismaClient;
let container: Container;

beforeAll(() => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida (¿se cargó .env.test?)");
  }
  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });
  container = buildContainer(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.user.deleteMany();
});

describe("auth.register (integration)", () => {
  it("happy path: persiste el usuario en Postgres con hash bcrypt", async () => {
    const user = await container.registerUser.execute({
      email: "smoke@example.com",
      password: "correcthorsebatterystaple",
      displayName: "Smoke User",
    });

    expect(user.email.value).toBe("smoke@example.com");
    expect(user.displayName).toBe("Smoke User");

    const row = await prisma.user.findUniqueOrThrow({
      where: { email: "smoke@example.com" },
    });
    expect(row.id).toBe(user.id);
    expect(row.displayName).toBe("Smoke User");
    expect(row.hashedPassword.startsWith("$2")).toBe(true);
    expect(row.hashedPassword.length).toBeGreaterThanOrEqual(55);
    expect(row.hashedPassword).not.toBe("correcthorsebatterystaple");
  });

  it("rechaza email duplicado con EmailAlreadyRegisteredError y deja una sola fila", async () => {
    await container.registerUser.execute({
      email: "dup@example.com",
      password: "correcthorsebatterystaple",
      displayName: "First",
    });

    await expect(
      container.registerUser.execute({
        email: "dup@example.com",
        password: "anothervalidpassword",
        displayName: "Second",
      }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);

    const count = await prisma.user.count({
      where: { email: "dup@example.com" },
    });
    expect(count).toBe(1);
  });
});
