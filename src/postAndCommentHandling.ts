import { TriggerContext, User } from "@devvit/public-api";
import { PostCreate, CommentCreate, PostDelete, CommentDelete } from "@devvit/protos";
import { isCommentId } from "@devvit/shared-types/tid.js";
import { userIsMod } from "./utility.js";
import { addDays, endOfDay, formatDate } from "date-fns";
import { setCleanupForUsers } from "./cleanup.js";
import { commentCountKey, postCountKey, postVotesKey, userCommentCountKey, userPostCountKey } from "./redisHelper.js";
import { Setting } from "./settings.js";
import { addFilteredItem } from "./filteredStore.js";

async function userOnIgnoreList (username: string, subreddit: string, context: TriggerContext): Promise<boolean> {
    const settings = await context.settings.getAll();

    if (username === "AutoModerator" && settings[Setting.IgnoreAutoMod]) {
        return true;
    }

    if (username === `${subreddit}-ModTeam` && settings[Setting.IgnoreModTeamUser]) {
        return true;
    }

    if (settings[Setting.UserIgnoreList]) {
        const ignoredUserList = (settings[Setting.UserIgnoreList] as string).split(",").map(item => item.trim().toLowerCase());
        if (ignoredUserList.includes(username.toLowerCase())) {
            return true;
        }
    }

    if (settings[Setting.IgnoreAllModerators]) {
        const isMod = await userIsMod(username, subreddit, context);
        if (isMod) {
            return true;
        }
    }

    return false;
}

export async function handlePostCreate (event: PostCreate, context: TriggerContext) {
    if (!event.post || !event.author || !event.subreddit) {
        return;
    }

    if (event.post.spam) {
        // Store record of post/comment for later checking.
        console.log(`${event.post.id}: New filtered post from ${event.author.name}. Storing for later checking.`);
        await addFilteredItem(event.post.id, context);
        return;
    }

    if (await userOnIgnoreList(event.author.name, event.subreddit.name, context)) {
        return;
    }

    await handlePostOrCommentCreateOrApprove(event.post.id, event.author.name, new Date(event.post.createdAt), "New", context);
}

export async function handleCommentCreate (event: CommentCreate, context: TriggerContext) {
    if (!event.comment || !event.author || !event.subreddit) {
        return;
    }

    if (event.comment.spam) {
        // Store record of post/comment for later checking.
        console.log(`${event.comment.id}: New filtered comment from ${event.author.name}. Storing for later checking.`);
        await addFilteredItem(event.comment.id, context);
        return;
    }

    if (await userOnIgnoreList(event.author.name, event.subreddit.name, context)) {
        return;
    }

    await handlePostOrCommentCreateOrApprove(event.comment.id, event.author.name, new Date(event.comment.createdAt), "New", context);
}

async function isUserVisible (username: string, context: TriggerContext): Promise<boolean> {
    const redisKey = `uservisible~username`;
    const value = await context.redis.get(redisKey);
    if (value) {
        return JSON.parse(value) as boolean;
    } else {
        let user: User | undefined;
        try {
            user = await context.reddit.getUserByUsername(username);
        } catch {
            //
        }
        const userVisible = user !== undefined;
        await context.redis.set(redisKey, JSON.stringify(userVisible), { expiration: addDays(new Date(), 7) });
        return userVisible;
    }
}

export async function handlePostOrCommentCreateOrApprove (thingId: string, authorName: string, date: Date, action: string, context: TriggerContext) {
    const kind = isCommentId(thingId) ? "comment" : "post";

    const itemKey = `item~${thingId}`;
    const itemHandled = await context.redis.get(itemKey);
    if (itemHandled) {
        return;
    }

    // Check to see if user is shadowbanned. If so, don't record data.
    const userVisible = await isUserVisible(authorName, context);
    if (!userVisible) {
        console.log(`${thingId}: ${action} ${kind} from ${authorName} who is shadowbanned. Data not recorded.`);
        return;
    }

    if (kind === "post") {
        // Store post upvotes for later calculation.
        await context.redis.zAdd(postVotesKey(date), { member: thingId, score: 0 });
    }

    // Increment count for the day.
    const itemCountKey = kind === "post" ? postCountKey(date) : commentCountKey(date);
    const newItemCount = await context.redis.zIncrBy(itemCountKey, formatDate(date, "dd"), 1);
    const authorCountKey = kind === "post" ? userPostCountKey(date) : userCommentCountKey(date);
    const newAuthorCount = await context.redis.zIncrBy(authorCountKey, authorName, 1);
    console.log(`${thingId}: ${action} ${kind} from ${authorName}. Today: ${newItemCount}. Author in month: ${newAuthorCount}`);

    // Store a record of this item being created, in order to handle deletes later.
    await context.redis.set(itemKey, `${authorName}~${formatDate(date, "yyyy-MM-dd")}`, { expiration: endOfDay(addDays(new Date(), 1)) });

    // Store cleanup entry
    await setCleanupForUsers([authorName], context);
}

export async function handlePostDelete (event: PostDelete, context: TriggerContext) {
    await handlePostOrCommentDelete(event.postId, event.source, context);
}

export async function handleCommentDelete (event: CommentDelete, context: TriggerContext) {
    await handlePostOrCommentDelete(event.commentId, event.source, context);
}

export async function handlePostOrCommentDelete (thingId: string, source: number, context: TriggerContext) {
    const kind = isCommentId(thingId) ? "comment" : "post";
    const itemKey = `item~${thingId}`;
    const itemResult = await context.redis.get(itemKey);
    if (!itemResult) {
        // Duplicate trigger, or belated deletion.
        return;
    }

    const [authorName, dateStr] = itemResult.split("~");
    const date = dateStr ? new Date(dateStr) : new Date();

    const eventSource = ["unknown", "user", "admin", "moderator", "unrecognised"];

    console.log(`${thingId}: deleted or removed for ${authorName}. Source: ${eventSource[source]}`);

    // Decrement counts.
    const itemCountKey = kind === "post" ? postCountKey(date) : commentCountKey(date);
    const itemNewDayCount = await context.redis.zIncrBy(itemCountKey, formatDate(date, "dd"), -1);
    if (itemNewDayCount <= 0) {
        await context.redis.zRem(itemCountKey, [formatDate(date, "dd")]);
    }
    const authorCountKey = kind === "post" ? userPostCountKey(date) : userCommentCountKey(date);
    const authorNewCount = await context.redis.zIncrBy(authorCountKey, authorName, -1);
    if (authorNewCount <= 0) {
        await context.redis.zRem(authorCountKey, [authorName]);
    }

    if (kind === "post") {
        await context.redis.zRem(postVotesKey(date), [thingId]);
    }
    await context.redis.del(itemKey);

    if (source !== 1) {
        // Removed by someone other than themeselves - may be modqueued.
        await addFilteredItem(thingId, context);
    }
}
