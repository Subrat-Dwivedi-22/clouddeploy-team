ALTER TABLE "Project" ADD COLUMN "repository" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "runId" TEXT;
CREATE INDEX "Deployment_build_queue" ON "Deployment" ("createdAt") WHERE outcome = 'Building';
