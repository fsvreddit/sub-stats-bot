import { Devvit } from "@devvit/public-api";
import { handleAppInstallEvents, handleAppInstallUpgradeEvents } from "./installEvents.js";
import { storeSubscriberCount } from "./subscriberCount.js";
import { handleCommentCreate, handleCommentDelete, handlePostCreate, handlePostDelete } from "./postAndCommentHandling.js";
import { cleanupDeletedAccounts, cleanupTopAccounts } from "./cleanup.js";
import { calculatePostVotes } from "./postCalculations.js";
import { appSettings } from "./settings.js";
import { updateWikiPageAtEndOfDay, updateWikiPageAtEndOfYear, updateWikiPagePermissions } from "./wikiPages.js";
import { handleModAction } from "./modActionHandling.js";
import { JOB_CALCULATE_POST_VOTES, JOB_CLEANUP_DELETED_USER, JOB_CLEANUP_FILTERED_STORE, JOB_CLEANUP_TOP_ACCOUNTS, JOB_STORE_SUBSCRIBER_COUNT, JOB_UPDATE_WIKI_PAGE_END_DAY, JOB_UPDATE_WIKI_PAGE_END_YEAR } from "./constants.js";
import { cleanupFilteredStore } from "./filteredStore.js";

Devvit.addSettings(appSettings);

Devvit.addTrigger({
    event: "AppInstall",
    onEvent: handleAppInstallEvents,
});

Devvit.addTrigger({
    events: ["AppInstall", "AppUpgrade"],
    onEvent: handleAppInstallUpgradeEvents,
});

Devvit.addTrigger({
    event: "PostCreate",
    onEvent: handlePostCreate,
});

Devvit.addTrigger({
    event: "CommentCreate",
    onEvent: handleCommentCreate,
});

Devvit.addTrigger({
    event: "PostDelete",
    onEvent: handlePostDelete,
});

Devvit.addTrigger({
    event: "CommentDelete",
    onEvent: handleCommentDelete,
});

Devvit.addTrigger({
    event: "ModAction",
    onEvent: handleModAction,
});

// Scheduled Jobs
Devvit.addSchedulerJob({
    name: JOB_CLEANUP_DELETED_USER,
    onRun: cleanupDeletedAccounts,
});

Devvit.addSchedulerJob({
    name: JOB_CLEANUP_FILTERED_STORE,
    onRun: cleanupFilteredStore,
});

Devvit.addSchedulerJob({
    name: JOB_CLEANUP_TOP_ACCOUNTS,
    onRun: cleanupTopAccounts,
});

Devvit.addSchedulerJob({
    name: JOB_STORE_SUBSCRIBER_COUNT,
    onRun: storeSubscriberCount,
});

Devvit.addSchedulerJob({
    name: JOB_CALCULATE_POST_VOTES,
    onRun: calculatePostVotes,
});

Devvit.addSchedulerJob({
    name: JOB_UPDATE_WIKI_PAGE_END_DAY,
    onRun: updateWikiPageAtEndOfDay,
});

Devvit.addSchedulerJob({
    name: JOB_UPDATE_WIKI_PAGE_END_YEAR,
    onRun: updateWikiPageAtEndOfYear,
});

Devvit.addSchedulerJob({
    name: "updateWikiPagePermissions",
    onRun: updateWikiPagePermissions,
});

Devvit.addMenuItem({
    label: "Update Sub Statistics",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_, context) => {
        await context.scheduler.runJob({
            name: JOB_UPDATE_WIKI_PAGE_END_DAY,
            runAt: new Date(),
        });
        context.ui.showToast("Stats will now be updated.");
    },
});

Devvit.configure({
    redditAPI: true,
    redis: true,
});

export default Devvit;
