import { JobContext, TriggerContext } from "@devvit/public-api";
import { addDays } from "date-fns";
import pluralize from "pluralize";

const FILTERED_ITEMS_KEY = "filteredItems";

export async function addFilteredItem (thingId: string, context: TriggerContext) {
    await context.redis.zAdd(FILTERED_ITEMS_KEY, { member: thingId, score: addDays(new Date(), 2).getTime() });
}

export async function cleanupFilteredStore (_: unknown, context: JobContext) {
    // Check for items in the filtered store that aren't in the modqueue. These will have been actually removed not filtered.
    const filteredItems = (await context.redis.zRange(FILTERED_ITEMS_KEY, 0, new Date().getTime(), { by: "score" })).map(item => item.member);
    if (filteredItems.length === 0) {
        return;
    }

    const modQueue = await context.reddit.getModQueue({
        subreddit: context.subredditName ?? await context.reddit.getCurrentSubredditName(),
        type: "all",
        limit: 1000,
    }).all();

    const itemsNotActuallyFiltered = filteredItems.filter(item => !modQueue.some(queuedItem => queuedItem.id === item));
    if (itemsNotActuallyFiltered.length > 0) {
        const removedCount = await context.redis.zRem(FILTERED_ITEMS_KEY, itemsNotActuallyFiltered);
        console.log(`Cleanup: Removed ${removedCount} ${pluralize("item", filteredItems.length)} from the filtered item store.`);
    }
}

export async function itemWasFiltered (thingId: string, context: TriggerContext): Promise<boolean> {
    const wasFiltered = await context.redis.zScore(FILTERED_ITEMS_KEY, thingId);
    return wasFiltered !== undefined;
}
