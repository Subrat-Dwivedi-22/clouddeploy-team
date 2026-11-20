ALTER TABLE "Deployment" ADD COLUMN "commitSha" TEXT, ADD COLUMN "buildSeconds" INTEGER;
UPDATE "Deployment" SET "commitSha" = substring(detail from 'Commit ([a-f0-9]{12})')
WHERE "runId" IS NOT NULL;
