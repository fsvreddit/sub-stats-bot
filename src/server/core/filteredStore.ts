import { context, reddit, redis } from "@devvit/web/server";
import { addDays } from "date-fns";
import pluralize from "pluralize";

const FILTERED_ITEMS_KEY = "filteredItems";

export async function addFilteredItem (thingId: string) {
    await redis.zAdd(FILTERED_ITEMS_KEY, { member: thingId, score: addDays(new Date(), 2).getTime() });
}

export async function cleanupFilteredStore () {
    // Check for items in the filtered store that aren't in the modqueue. These will have been actually removed not filtered.
    const filteredItems = (await redis.zRange(FILTERED_ITEMS_KEY, 0, new Date().getTime(), { by: "score" })).map(item => item.member);
    if (filteredItems.length === 0) {
        return;
    }

    const modQueue = await reddit.getModQueue({
        subreddit: context.subredditName,
        type: "all",
        limit: 1000,
    }).all();

    const itemsNotActuallyFiltered = filteredItems.filter(item => !modQueue.some(queuedItem => queuedItem.id === item));
    if (itemsNotActuallyFiltered.length > 0) {
        const removedCount = await redis.zRem(FILTERED_ITEMS_KEY, itemsNotActuallyFiltered);
        console.log(`Cleanup: Removed ${removedCount} ${pluralize("item", filteredItems.length)} from the filtered item store.`);
    }
}

export async function itemWasFiltered (thingId: string): Promise<boolean> {
    const wasFiltered = await redis.zScore(FILTERED_ITEMS_KEY, thingId);
    return wasFiltered !== undefined;
}
