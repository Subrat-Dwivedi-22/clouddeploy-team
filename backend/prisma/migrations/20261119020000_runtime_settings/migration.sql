ALTER TABLE "Project" ADD COLUMN "healthPath" TEXT,
  ADD COLUMN "resourceProfile" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "Deployment" ADD COLUMN "healthPath" TEXT,
  ADD COLUMN "resourceProfile" TEXT NOT NULL DEFAULT 'standard';
