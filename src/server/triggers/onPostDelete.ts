import { OnPostDeleteRequest, TriggerResponse } from "@devvit/web/shared";
import { hasEventBeenHandled } from "@fsvreddit/fsv-devvit-web-helpers";
import { Context } from "hono";
import { handlePostOrCommentDelete } from "../core";

export const onPostDelete = async (c: Context): Promise<Response> => {
    const event = await c.req.json<OnPostDeleteRequest>();

    if (await hasEventBeenHandled(`postDelete:${event.postId}:${event.deletedAt}`)) {
        return c.json<TriggerResponse>({ message: "Event already handled" }, 200);
    }

    await handlePostOrCommentDelete(event.postId, event.source);

    return c.json<TriggerResponse>({ message: "Event handled" }, 200);
};
