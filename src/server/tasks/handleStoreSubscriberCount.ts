import { reddit, redis, TaskResponse } from "@devvit/web/server";
import { Context } from "hono";
import { SUBS_KEY } from "../core";
import { formatDate } from "date-fns";

export const handleStoreSubscriberCountJob = async (c: Context): Promise<Response> => {
    const subreddit = await reddit.getCurrentSubreddit();
    await redis.zAdd(SUBS_KEY, { member: formatDate(new Date(), `yyyy-MM-dd`), score: subreddit.numberOfSubscribers });
    console.log(`Subscriber count stored. Value: ${subreddit.numberOfSubscribers}`);

    return c.json<TaskResponse>({ message: "Subscriber count stored." }, 200);
};
