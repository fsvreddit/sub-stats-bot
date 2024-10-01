import { JobContext, ScheduledJobEvent, TriggerContext, User } from "@devvit/public-api";
import { APP_INSTALL_DATE, CLEANUP_KEY, FILTERED_ITEMS_KEY } from "./redisHelper.js";
import { addDays, addMinutes, eachMonthOfInterval, interval, subMinutes } from "date-fns";
import { userCommentCountKey, userPostCountKey } from "./redisHelper.js";
import { CLEANUP_CRON, JOB_CLEANUP_DELETED_USER } from "./constants.js";
import { parseExpression } from "cron-parser";
import pluralize from "pluralize";
import { getSubredditName } from "./utility.js";

const DAYS_BETWEEN_CHECKS = 28;

export async function setCleanupForUsers (usernames: string[], context: TriggerContext) {
    if (usernames.length === 0) {
        return;
    }
    await context.redis.zAdd(CLEANUP_KEY, ...usernames.map(username => ({ member: username, score: addDays(new Date(), DAYS_BETWEEN_CHECKS).getTime() })));
}

async function userActive (username: string, context: TriggerContext): Promise<boolean> {
    let user: User | undefined;
    try {
        user = await context.reddit.getUserByUsername(username);
    } catch {
        //
    }

    if (!user) {
        console.log(`Cleanup: ${username} appears to be deleted or shadowbanned.`);
    }

    return user !== undefined;
}

interface UserActive {
    username: string;
    isActive: boolean;
}

export async function cleanupDeletedAccounts (_: ScheduledJobEvent<undefined>, context: JobContext) {
    console.log("Cleanup: Starting cleanup job");

    const items = await context.redis.zRange(CLEANUP_KEY, 0, new Date().getTime(), { by: "score" });
    if (items.length === 0) {
        // No user accounts need to be checked.
        await scheduleAdhocCleanup(context);
        return;
    }

    const itemsToCheck = 50;

    if (items.length > itemsToCheck) {
        console.log(`Cleanup: ${items.length} ${pluralize("account", items.length)} ${pluralize("is", items.length)} due a check. Checking first ${itemsToCheck} in this run.`);
    } else {
        console.log(`Cleanup: ${items.length} ${pluralize("account", items.length)} ${pluralize("is", items.length)} due a check.`);
    }

    // Get the first N accounts that are due a check.
    const usersToCheck = items.slice(0, itemsToCheck).map(item => item.member);
    const userStatuses: UserActive[] = [];

    for (const username of usersToCheck) {
        const isActive = await userActive(username, context);
        userStatuses.push({ username, isActive });
    }

    const activeUsers = userStatuses.filter(user => user.isActive).map(user => user.username);
    const deletedUsers = userStatuses.filter(user => !user.isActive).map(user => user.username);

    // For active users, set their next check date to be one day from now.
    if (activeUsers.length > 0) {
        console.log(`Cleanup: ${activeUsers.length} ${pluralize("user", activeUsers.length)} still active out of ${userStatuses.length}. Resetting next check time.`);
        await setCleanupForUsers(activeUsers, context);
    }

    // For deleted users, remove them from both the cleanup log and remove previous records of bans and approvals.
    if (deletedUsers.length > 0) {
        console.log(`Cleanup: ${deletedUsers.length} ${pluralize("user", deletedUsers.length)} out of ${userStatuses.length} ${pluralize("is", deletedUsers.length)} deleted or suspended. Removing from data store.`);
        await removeAllRecordsForUsers(deletedUsers, context);
    }

    if (items.length > itemsToCheck) {
        await context.scheduler.runJob({
            runAt: new Date(),
            name: JOB_CLEANUP_DELETED_USER,
        });
    } else {
        await scheduleAdhocCleanup(context);
    }
}

async function removeAllRecordsForUsers (deletedUsers: string[], context: TriggerContext) {
    const installDateValue = await context.redis.get(APP_INSTALL_DATE);
    if (!installDateValue) {
        // Impossible, set on install.
        return;
    }

    const installDate = new Date(installDateValue);
    const allMonthsInScope = eachMonthOfInterval(interval(installDate, new Date()));
    let storedEntriesRemoved = 0;
    // For each month, remove every user.
    for (const month of allMonthsInScope) {
        storedEntriesRemoved += await context.redis.zRem(userPostCountKey(month), deletedUsers);
        storedEntriesRemoved += await context.redis.zRem(userCommentCountKey(month), deletedUsers);
    }

    storedEntriesRemoved += await context.redis.zRem(CLEANUP_KEY, deletedUsers);

    console.log(`Cleanup: Removed ${storedEntriesRemoved} ${pluralize("entry", storedEntriesRemoved)} from redis.`);
}

export async function scheduleAdhocCleanup (context: TriggerContext) {
    const nextEntries = await context.redis.zRange(CLEANUP_KEY, 0, 0, { by: "rank" });

    if (nextEntries.length === 0) {
        return;
    }

    const nextCleanupTime = new Date(nextEntries[0].score);
    const nextCleanupJobTime = addMinutes(nextCleanupTime, 5);
    const nextScheduledTime = parseExpression(CLEANUP_CRON).next().toDate();

    if (nextCleanupJobTime < subMinutes(nextScheduledTime, 5)) {
        // It's worth running an ad-hoc job.
        console.log(`Cleanup: Next ad-hoc cleanup: ${nextCleanupJobTime.toUTCString()}`);
        await context.scheduler.runJob({
            name: JOB_CLEANUP_DELETED_USER,
            runAt: nextCleanupJobTime,
        });
    } else {
        console.log(`Cleanup: Next entry in cleanup log is after next scheduled run (${nextCleanupTime.toUTCString()}).`);
        console.log(`Cleanup: Next cleanup job: ${nextScheduledTime.toUTCString()}`);
    }
}

export async function addFilteredItem (thingId: string, context: TriggerContext) {
    await context.redis.zAdd(FILTERED_ITEMS_KEY, { member: thingId, score: addDays(new Date(), 2).getTime() });
}

export async function cleanupFilteredStore (_: ScheduledJobEvent<undefined>, context: JobContext) {
    // Check for items in the filtered store that aren't in the modqueue. These will have been actually removed not filtered.
    const filteredItems = (await context.redis.zRange(FILTERED_ITEMS_KEY, 0, new Date().getTime(), { by: "score" })).map(item => item.member);
    if (filteredItems.length === 0) {
        return;
    }

    const modQueue = await context.reddit.getModQueue({
        subreddit: await getSubredditName(context),
        type: "all",
        limit: 1000,
    }).all();

    const itemsNotActuallyFiltered = filteredItems.filter(item => !modQueue.some(queuedItem => queuedItem.id === item));
    if (itemsNotActuallyFiltered.length > 0) {
        const removedCount = await context.redis.zRem(FILTERED_ITEMS_KEY, itemsNotActuallyFiltered);
        console.log(`Cleanup: Removed ${removedCount} ${pluralize("item", filteredItems.length)} from the filtered item store.`);
    }
}
