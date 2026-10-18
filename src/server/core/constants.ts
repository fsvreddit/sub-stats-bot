export enum SchedulerJob {
    CleanupDeletedAccounts = "cleanupDeletedAccounts",
    CleanupFilteredStore = "cleanupFilteredStore",
    CleanupTopAccounts = "cleanupTopAccounts",
    StoreSubscriberCount = "storeSubscriberCount",
    CalculatePostVotes = "calculatePostVotes",
    UpdateWikiPageEndDay = "updateWikiPageAtEndOfDay",
    UpdateWikiPageEndYear = "updateWikiPageAtEndOfYear",
    UpdateWikiPermissions = "updateWikiPagePermissions",
    InitialInstallTasks = "initialInstallTasks",
}

// Job Schedules
export const CLEANUP_CRON = "0 23 * * *";
