import { OnCommentDeleteRequest, TriggerResponse } from "@devvit/web/shared";
import { hasEventBeenHandled } from "@fsvreddit/fsv-devvit-web-helpers";
import { Context } from "hono";
import { handlePostOrCommentDelete } from "../core";

export const onCommentDelete = async (c: Context): Promise<Response> => {
    const event = await c.req.json<OnCommentDeleteRequest>();

    if (await hasEventBeenHandled(`commentDelete:${event.commentId}:${event.deletedAt}`)) {
        return c.json<TriggerResponse>({ message: "Event already handled" }, 200);
    }

    await handlePostOrCommentDelete(event.commentId, event.source);

    return c.json<TriggerResponse>({ message: "Event handled" }, 200);
};
