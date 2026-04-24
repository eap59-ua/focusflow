process.loadEnvFile();

const config = {
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
};

export default config;
