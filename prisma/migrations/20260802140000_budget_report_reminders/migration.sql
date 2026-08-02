-- Report reminders. Nothing in the portal has ever told a partner a report is
-- due — they learn they are late when someone WhatsApps them. The log exists so
-- a re-run on the same day is a no-op, keyed by recipient because one slot
-- reminds both the grantee organisation and the internal grant lead.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BudgetReportDue';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BudgetReportOverdue';

CREATE TABLE "BudgetReportReminderLog" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetReportReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BudgetReportReminderLog_slotId_userId_type_channel_key"
    ON "BudgetReportReminderLog"("slotId", "userId", "type", "channel");
CREATE INDEX "BudgetReportReminderLog_slotId_idx" ON "BudgetReportReminderLog"("slotId");

ALTER TABLE "BudgetReportReminderLog" ADD CONSTRAINT "BudgetReportReminderLog_slotId_fkey"
    FOREIGN KEY ("slotId") REFERENCES "BudgetReportSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The cron sweeps every open slot by due date each night.
CREATE INDEX "BudgetReportSlot_status_dueDate_idx" ON "BudgetReportSlot"("status", "dueDate");
