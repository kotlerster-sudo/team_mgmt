-- Handing someone a task, and deploying catalog items onto their centre, both
-- need their own notification type: /notifications branches on `type` to decide
-- which inline actions to render, so borrowing ActivityFollowup would offer a
-- "mark the activity done" control against work that has no activity.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TaskAssigned';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CatalogItemDeployed';
