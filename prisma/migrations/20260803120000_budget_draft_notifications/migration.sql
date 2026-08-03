-- Notification types for the grant-making round-trip. Separate from the
-- reporting ones (BudgetReportDue / BudgetReportOverdue): this is the earlier
-- half of the relationship, before the budget is approved at all.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BudgetDraftShared';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BudgetDraftSubmitted';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BudgetDraftSentBack';
