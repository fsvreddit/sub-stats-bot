import { OnCommentCreateRequest, TriggerResponse } from "@devvit/web/shared";
import { fixCommentTriggerEvent, hasEventBeenHandled } from "@fsvreddit/fsv-devvit-web-helpers";
import { Context } from "hono";
import { addFilteredItem, handlePostOrCommentCreateOrApprove, userOnIgnoreList } from "../core";

export const onCommentCreate = async (c: Context): Promise<Response> => {
    const event = await fixCommentTriggerEvent(await c.req.json<OnCommentCreateRequest>());

    if (!event.comment || !event.author || !event.subreddit) {
        return c.json<TriggerResponse>({ message: "Invalid event" }, 200);
    }

    if (await hasEventBeenHandled(`commentCreate:${event.comment.id}`)) {
        return c.json<TriggerResponse>({ message: "Event already handled" }, 200);
    }

    if (event.comment.spam) {
        // Store record of post/comment for later checking.
        console.log(`${event.comment.id}: New filtered comment from ${event.author.name}. Storing for later checking.`);
        await addFilteredItem(event.comment.id);
        return c.json<TriggerResponse>({ message: "Comment is spam" }, 200);
    }

    if (await userOnIgnoreList(event.author.name, event.subreddit.name)) {
        return c.json<TriggerResponse>({ message: "User is on ignore list" }, 200);
    }

    await handlePostOrCommentCreateOrApprove(event.comment.id, event.author.name, new Date(event.comment.createdAt), "New");

    return c.json<TriggerResponse>({ message: "Comment handled successfully" }, 200);
};
