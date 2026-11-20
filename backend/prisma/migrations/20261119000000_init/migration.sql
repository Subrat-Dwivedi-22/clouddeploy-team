CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL
);
CREATE TABLE "Project" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "image" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "replicas" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Project_ownerId_createdAt_idx" ON "Project"("ownerId", "createdAt");
CREATE TABLE "Deployment" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "image" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "replicas" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Deployment_projectId_createdAt_idx" ON "Deployment"("projectId", "createdAt");
