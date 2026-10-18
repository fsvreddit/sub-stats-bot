import { reddit, redis, settings, User } from "@devvit/web/server";
import { isT1 } from "@devvit/web/shared";
import { userIsMod } from "./utility.js";
import { addDays, endOfDay, formatDate } from "date-fns";
import { AppSetting, setCleanupForUsers } from ".";
import { commentCountKey, postCountKey, postVotesKey, userCommentCountKey, userPostCountKey } from "./redisHelper.js";
import { addFilteredItem } from "./filteredStore.js";

export async function userOnIgnoreList (username: string, subreddit: string): Promise<boolean> {
    const appSettings = await settings.getAll();

    if (username === "AutoModerator" && appSettings[AppSetting.IgnoreAutoMod]) {
        return true;
    }

    if (username === `${subreddit}-ModTeam` && appSettings[AppSetting.IgnoreModTeamUser]) {
        return true;
    }

    if (appSettings[AppSetting.UserIgnoreList]) {
        const ignoredUserList = (appSettings[AppSetting.UserIgnoreList] as string).split(",").map(item => item.trim().toLowerCase());
        if (ignoredUserList.includes(username.toLowerCase())) {
            return true;
        }
    }

    if (appSettings[AppSetting.IgnoreAllModerators]) {
        const isMod = await userIsMod(username, subreddit);
        if (isMod) {
            return true;
        }
    }

    return false;
}

export async function isUserVisible (username: string): Promise<boolean> {
    const redisKey = `uservisible~${username}`;
    const value = await redis.get(redisKey);
    if (value) {
        return JSON.parse(value) as boolean;
    } else {
        let user: User | undefined;
        try {
            user = await reddit.getUserByUsername(username);
        } catch {
            //
        }
        const userVisible = user !== undefined;
        await redis.set(redisKey, JSON.stringify(userVisible), { expiration: addDays(new Date(), 7) });
        return userVisible;
    }
}

export async function handlePostOrCommentCreateOrApprove (thingId: string, authorName: string, date: Date, action: string) {
    const kind = isT1(thingId) ? "comment" : "post";

    const itemKey = `item~${thingId}`;
    const itemHandled = await redis.get(itemKey);
    if (itemHandled) {
        return;
    }

    // Check to see if user is shadowbanned. If so, don't record data
    const userVisible = await isUserVisible(authorName);
    if (!userVisible) {
        console.log(`${thingId}: ${action} ${kind} from ${authorName} who is shadowbanned. Data not recorded.`);
        return;
    }

    if (kind === "post") {
        // Store post upvotes for later calculation
        await redis.zAdd(postVotesKey(date), { member: thingId, score: 0 });
    }

    // Increment count for the day.
    const itemCountKey = kind === "post" ? postCountKey(date) : commentCountKey(date);
    const newItemCount = await redis.zIncrBy(itemCountKey, formatDate(date, "dd"), 1);
    const authorCountKey = kind === "post" ? userPostCountKey(date) : userCommentCountKey(date);
    const newAuthorCount = await redis.zIncrBy(authorCountKey, authorName, 1);
    console.log(`${thingId}: ${action} ${kind} from ${authorName}. Today: ${newItemCount}. Author in month: ${newAuthorCount}`);

    // Store a record of this item being created, in order to handle deletes later
    await redis.set(itemKey, `${authorName}~${formatDate(date, "yyyy-MM-dd")}`, { expiration: endOfDay(addDays(new Date(), 1)) });

    // Store cleanup entry
    await setCleanupForUsers([authorName]);
}

export async function handlePostOrCommentDelete (thingId: string, source: number) {
    const kind = isT1(thingId) ? "comment" : "post";
    const itemKey = `item~${thingId}`;
    const itemResult = await redis.get(itemKey);
    if (!itemResult) {
        // Duplicate trigger, or belated deletion
        return;
    }

    const [authorName, dateStr] = itemResult.split("~");

    if (!authorName || !dateStr) {
        return;
    }

    const date = dateStr ? new Date(dateStr) : new Date();

    const eventSource = ["unknown", "user", "admin", "moderator", "unrecognised"];

    console.log(`${thingId}: deleted or removed for ${authorName}. Source: ${eventSource[source]}`);

    // Decrement counts
    const itemCountKey = kind === "post" ? postCountKey(date) : commentCountKey(date);
    const itemNewDayCount = await redis.zIncrBy(itemCountKey, formatDate(date, "dd"), -1);
    if (itemNewDayCount <= 0) {
        await redis.zRem(itemCountKey, [formatDate(date, "dd")]);
    }
    const authorCountKey = kind === "post" ? userPostCountKey(date) : userCommentCountKey(date);
    const authorNewCount = await redis.zIncrBy(authorCountKey, authorName, -1);
    if (authorNewCount <= 0) {
        await redis.zRem(authorCountKey, [authorName]);
    }

    if (kind === "post") {
        await redis.zRem(postVotesKey(date), [thingId]);
    }
    await redis.del(itemKey);

    if (source !== 1) {
        // Removed by someone other than themeselves - may be modqueued
        await addFilteredItem(thingId);
    }
}
