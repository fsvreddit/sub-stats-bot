import { Hono } from "hono";
import { createServer, getServerPort } from "@devvit/web/server";
import { getRequestListener } from "@hono/node-server";
import { validateWikiPermissions } from "./validators";
import { handleCleanupFilteredStoreJob, handleStoreSubscriberCountJob, handleUpdateWikiPermissionsJob, handleCleanupDeletedAccountsJob, handleCleanupTopAccountsJob, handleCalculatePostVotesJob, handleUpdateWikiPageAtEndOfDayJob, handleInitialInstallTasksJob, handleUpdateWikiPageAtEndOfYearJob } from "./tasks";
import { onAppInstall, onAppUpgrade, onModAction, onPostCreate, onPostDelete, onCommentCreate, onCommentDelete } from "./triggers";

const application = new Hono();

// Triggers
application.post("/internal/triggers/app-install", onAppInstall);
application.post("/internal/triggers/app-upgrade", onAppUpgrade);
application.post("/internal/triggers/mod-action", onModAction);
application.post("/internal/triggers/post-create", onPostCreate);
application.post("/internal/triggers/post-delete", onPostDelete);
application.post("/internal/triggers/comment-create", onCommentCreate);
application.post("/internal/triggers/comment-delete", onCommentDelete);

// Settings validators
application.post("/internal/validators/wiki-permissions", validateWikiPermissions);

// Tasks
application.post("/internal/tasks/cleanup-filtered-store", handleCleanupFilteredStoreJob);
application.post("/internal/tasks/store-subscriber-count", handleStoreSubscriberCountJob);
application.post("/internal/tasks/update-wiki-page-permissions", handleUpdateWikiPermissionsJob);
application.post("/internal/tasks/cleanup-deleted-accounts", handleCleanupDeletedAccountsJob);
application.post("/internal/tasks/cleanup-top-accounts", handleCleanupTopAccountsJob);
application.post("/internal/tasks/calculate-post-votes", handleCalculatePostVotesJob);
application.post("/internal/tasks/initial-install-tasks", handleInitialInstallTasksJob);
application.post("/internal/tasks/update-wiki-page-at-end-of-day", handleUpdateWikiPageAtEndOfDayJob);
application.post("/internal/tasks/update-wiki-page-at-end-of-year", handleUpdateWikiPageAtEndOfYearJob);

// Menus

// Forms

const server = createServer(getRequestListener(application.fetch));
server.on("error", (err) => {
    console.error(`server error; ${err.stack}`);
});

const port = getServerPort();
server.listen(port);
