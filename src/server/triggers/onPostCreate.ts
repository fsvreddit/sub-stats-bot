import { OnPostCreateRequest, TriggerResponse } from "@devvit/web/shared";
import { fixPostTriggerEvent, hasEventBeenHandled } from "@fsvreddit/fsv-devvit-web-helpers";
import { Context } from "hono";
import { addFilteredItem, handlePostOrCommentCreateOrApprove, userOnIgnoreList } from "../core";

export const onPostCreate = async (c: Context): Promise<Response> => {
    const event = await fixPostTriggerEvent(await c.req.json<OnPostCreateRequest>());

    if (!event.post || !event.author || !event.subreddit) {
        return c.json<TriggerResponse>({ message: "Invalid event" }, 200);
    }

    if (await hasEventBeenHandled(`postCreate:${event.post.id}`)) {
        return c.json<TriggerResponse>({ message: "Event already handled" }, 200);
    }

    if (event.post.spam) {
        // Store record of post/comment for later checking
        console.log(`${event.post.id}: New filtered post from ${event.author.name}. Storing for later checking.`);
        await addFilteredItem(event.post.id);
        return c.json<TriggerResponse>({ message: "Post is filtered" }, 200);
    }

    if (await userOnIgnoreList(event.author.name, event.subreddit.name)) {
        return c.json<TriggerResponse>({ message: "User is on ignore list" }, 200);
    }

    await handlePostOrCommentCreateOrApprove(event.post.id, event.author.name, new Date(event.post.createdAt), "New");

    return c.json<TriggerResponse>({ message: "Post handled successfully" }, 200);
};
