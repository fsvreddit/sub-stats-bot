import { context, reddit, redis, scheduler, TaskRequest, User } from "@devvit/web/server";
import { aggregatedItems, APP_INSTALL_DATE, CLEANUP_KEY } from "./redisHelper.js";
import { addDays, addMinutes, eachMonthOfInterval, interval, startOfMonth, startOfYear, subMinutes } from "date-fns";
import { CLEANUP_CRON, SchedulerJob, userCommentCountKey, userPostCountKey } from ".";
import { CronExpressionParser } from "cron-parser";
import pluralize from "pluralize";
import { flatten, max, uniq } from "lodash";
import { CleanupDeletedAccountsJobData } from "../tasks";
import { hasEventBeenHandled } from "@fsvreddit/fsv-devvit-web-helpers";

const DAYS_BETWEEN_CHECKS = 28;

export async function setCleanupForUsers (usernames: string[]) {
    if (usernames.length === 0) {
        return;
    }
    await redis.zAdd(CLEANUP_KEY, ...usernames.map(username => ({ member: username, score: addDays(new Date(), DAYS_BETWEEN_CHECKS).getTime() })));
}

async function userActive (username: string): Promise<boolean> {
    let user: User | undefined;
    try {
        user = await reddit.getUserByUsername(username);
    } catch {
        //
    }

    if (!user) {
        // User may be shadowbanned or suspended. Check if mod notes are callable.
        try {
            await reddit.getModNotes({
                subreddit: context.subredditName,
                user: username,
            }).all();
            return true; // User is shadowbanned or suspended, not deleted
        } catch {
            console.log(`Cleanup: ${username} appears to be deleted.`);
            return false; // User is deleted, otherwise notes would be retrievable.
        }
    }

    return true;
}

interface UserActive {
    username: string;
    isActive: boolean;
}

export async function cleanupDeletedAccounts (event: TaskRequest<CleanupDeletedAccountsJobData | undefined>) {
    if (event.data?.runDate) {
        console.log(`Cleanup: Starting cleanup job scheduled for ${event.data.runDate}`);
    } else {
        console.log("Cleanup: Starting cleanup job");
    }

    if (event.data?.jobGuid && await hasEventBeenHandled(`job:${event.data.jobGuid}`, { expiration: addMinutes(new Date(), 5) })) {
        console.warn(`Cleanup job ${event.data.jobGuid} has already been handled. Skipping.`);
        return;
    }

    const items = await redis.zRange(CLEANUP_KEY, 0, new Date().getTime(), { by: "score" });
    if (items.length === 0) {
        // No user accounts need to be checked.
        await scheduleAdhocCleanup();
        return;
    }

    const itemsToCheck = 50;

    // Get the first N accounts that are due a check
    const usersToCheck = items.slice(0, itemsToCheck).map(item => item.member);
    await cleanupUsers(usersToCheck);

    if (items.length > itemsToCheck) {
        await scheduler.runJob<CleanupDeletedAccountsJobData>({
            runAt: new Date(),
            name: SchedulerJob.CleanupDeletedAccounts,
        });
    } else {
        await scheduleAdhocCleanup();
    }
}

export async function cleanupTopAccounts () {
    const installDateValue = await redis.get(APP_INSTALL_DATE);

    let firstMonth: Date;
    if (installDateValue) {
        firstMonth = max([startOfYear(new Date()), startOfMonth(new Date(installDateValue))]);
    } else {
        firstMonth = startOfYear(new Date());
    }

    const months = eachMonthOfInterval(interval(firstMonth, new Date()));

    const posters = await Promise.all(months.map(month => redis.zRange(userPostCountKey(month), 0, 99, { by: "rank", reverse: true })));
    const commenters = await Promise.all(months.map(month => redis.zRange(userCommentCountKey(month), 0, 99, { by: "rank", reverse: true })));

    const topN = 8; // 8 to account for maybe 1-2 defunct users since last check
    const allUsersToCheck = uniq([
        // Top N posters/commenters from the year to date
        ...aggregatedItems(flatten(posters)).slice(0, topN).map(item => item.member),
        ...aggregatedItems(flatten(commenters)).slice(0, topN).map(item => item.member),
        // Top N posters/commenters from each month
        ...flatten(posters.map(batch => batch.slice(0, topN).map(item => item.member))),
        ...flatten(commenters.map(batch => batch.slice(0, topN).map(item => item.member))),
    ]);

    console.log(`Cleanup: Checking ${allUsersToCheck.length} ${pluralize("user", allUsersToCheck.length)} that may be included in leaderboard.`);

    await cleanupUsers(allUsersToCheck);
}

async function cleanupUsers (usersToCheck: string[]) {
    const userStatuses: UserActive[] = [];

    for (const username of usersToCheck) {
        const isActive = await userActive(username);
        userStatuses.push({ username, isActive });
    }

    const activeUsers = userStatuses.filter(user => user.isActive).map(user => user.username);
    const deletedUsers = userStatuses.filter(user => !user.isActive).map(user => user.username);

    // For active users, set their next check date to be one day from now
    if (activeUsers.length > 0) {
        console.log(`Cleanup: ${activeUsers.length} ${pluralize("user", activeUsers.length)} still active out of ${userStatuses.length}. Resetting next check time.`);
        await setCleanupForUsers(activeUsers);
    }

    // For deleted users, remove them from both the cleanup log and remove previous records of bans and approvals
    if (deletedUsers.length > 0) {
        console.log(`Cleanup: ${deletedUsers.length} ${pluralize("user", deletedUsers.length)} out of ${userStatuses.length} ${pluralize("is", deletedUsers.length)} deleted or suspended. Removing from data store.`);
        await removeAllRecordsForUsers(deletedUsers);
    }
}

async function removeAllRecordsForUsers (deletedUsers: string[]) {
    const installDateValue = await redis.get(APP_INSTALL_DATE);
    if (!installDateValue) {
        // Impossible, set on install
        return;
    }

    const installDate = new Date(installDateValue);
    const allMonthsInScope = eachMonthOfInterval(interval(installDate, new Date()));
    let storedEntriesRemoved = 0;
    // For each month, remove every user
    for (const month of allMonthsInScope) {
        storedEntriesRemoved += await redis.zRem(userPostCountKey(month), deletedUsers);
        storedEntriesRemoved += await redis.zRem(userCommentCountKey(month), deletedUsers);
    }

    storedEntriesRemoved += await redis.zRem(CLEANUP_KEY, deletedUsers);

    console.log(`Cleanup: Removed ${storedEntriesRemoved} ${pluralize("entry", storedEntriesRemoved)} from redis.`);
}

export async function scheduleAdhocCleanup () {
    const nextEntries = await redis.zRange(CLEANUP_KEY, 0, 0, { by: "rank" });

    if (nextEntries.length === 0) {
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const nextCleanupTime = new Date(nextEntries[0]!.score);
    const nextCleanupJobTime = addMinutes(nextCleanupTime, 5);
    const nextScheduledTime = CronExpressionParser.parse(CLEANUP_CRON).next().toDate();

    if (nextCleanupJobTime < subMinutes(nextScheduledTime, 5)) {
        // It's worth running an ad-hoc job
        console.log(`Cleanup: Next ad-hoc cleanup: ${nextCleanupJobTime.toUTCString()}`);
        await scheduler.runJob<CleanupDeletedAccountsJobData>({
            data: { runDate: nextCleanupJobTime.toUTCString(), jobGuid: crypto.randomUUID() },
            name: SchedulerJob.CleanupDeletedAccounts,
            runAt: nextCleanupJobTime,
        });
    } else {
        console.log(`Cleanup: Next entry in cleanup log is after next scheduled run (${nextCleanupTime.toUTCString()}).`);
        console.log(`Cleanup: Next cleanup job: ${nextScheduledTime.toUTCString()}`);
    }
}
