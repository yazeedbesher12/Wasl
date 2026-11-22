-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('LESSON_RESOURCE', 'ASSESSMENT_ANSWER');

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "file_objects" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "purpose" "FilePurpose" NOT NULL,
    "lesson_id" UUID,
    "assessment_id" UUID,
    "storage_key" TEXT NOT NULL,
    "storage_driver" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_storage_key_key" ON "file_objects"("storage_key");

-- CreateIndex
CREATE INDEX "file_objects_school_id_idx" ON "file_objects"("school_id");

-- CreateIndex
CREATE INDEX "file_objects_owner_id_idx" ON "file_objects"("owner_id");

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Immutable object target/size integrity. Legacy metadata-only resources are not files.
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_target_check" CHECK (
  (purpose = 'LESSON_RESOURCE' AND lesson_id IS NOT NULL AND assessment_id IS NULL) OR
  (purpose = 'ASSESSMENT_ANSWER' AND assessment_id IS NOT NULL AND lesson_id IS NULL)
);
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_size_check" CHECK (size > 0 AND size <= 10485760);
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_driver_check" CHECK (storage_driver IN ('local', 's3'));
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_sha_check" CHECK (sha256 ~ '^[0-9a-f]{64}$');

-- Tenant policies for the features introduced here. The rest of the baseline
-- still requires the broader database-handoff RLS/grant review before deployment.
ALTER TABLE "file_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file_objects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "file_objects_school" ON "file_objects"
  USING (school_id::text = current_setting('app.school_id', true))
  WITH CHECK (school_id::text = current_setting('app.school_id', true));
ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "announcements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "announcements_school" ON "announcements"
  USING (school_id::text = current_setting('app.school_id', true))
  WITH CHECK (school_id::text = current_setting('app.school_id', true));
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notifications_school" ON "notifications"
  USING (school_id::text = current_setting('app.school_id', true))
  WITH CHECK (school_id::text = current_setting('app.school_id', true));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wasl_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "file_objects", "announcements", "notifications" TO wasl_app;
  END IF;
END $$;
