import { redis } from "@devvit/web/server";
import { OnModActionRequest, TriggerResponse } from "@devvit/web/shared";
import { Context } from "hono";
import { handlePostOrCommentCreateOrApprove } from "../core/postAndCommentHandling.js";
import { userIsMod } from "../core";
import { itemWasFiltered } from "../core/filteredStore.js";
import { hasEventBeenHandled } from "@fsvreddit/fsv-devvit-web-helpers";
import { addMinutes } from "date-fns";

async function hasModActionBeenHandled (event: OnModActionRequest): Promise<boolean> {
    return await hasEventBeenHandled(`modAction:${event.action}:${event.moderator?.name}:${event.actionedAt}`, { expiration: addMinutes(new Date(), 10) });
}

export const onModAction = async (c: Context): Promise<Response> => {
    const event = await c.req.json<OnModActionRequest>();

    if (event.action === "approvelink" || event.action === "approvecomment") {
        if (await hasModActionBeenHandled(event)) {
            return c.json<TriggerResponse>({ message: "Mod action has already been handled." }, 200);
        }

        let targetId: string | undefined;
        let date: Date | undefined;
        if (event.action === "approvelink" && event.targetPost) {
            targetId = event.targetPost.id;
            date = new Date(event.targetPost.createdAt);
        } else if (event.action === "approvecomment" && event.targetComment) {
            targetId = event.targetComment.id;
            date = new Date(event.targetComment.createdAt);
        }

        const authorName = event.targetUser?.name;

        if (!targetId || !authorName || !date) {
            return c.json<TriggerResponse>({ message: "Missing required information." }, 400);
        }

        const wasFiltered = await itemWasFiltered(targetId);
        if (!wasFiltered) {
            return c.json<TriggerResponse>({ message: "Item was not filtered." }, 200);
        }

        await handlePostOrCommentCreateOrApprove(targetId, authorName, date, "Approved");
    }

    const moderatorEvents = ["acceptmoderatorinvite", "addmoderator", "removemoderator", "reordermoderators"];

    if (event.action && event.targetUser && moderatorEvents.includes(event.action)) {
        if (await hasModActionBeenHandled(event)) {
            return c.json<TriggerResponse>({ message: "Mod action has already been handled." }, 200);
        }
        await redis.del("cachedModList");
        console.log(`Mod Action: Permissions for ${event.targetUser.name} changed, clearing cached mod list.`);

        // Cache mod list
        if (event.subreddit) {
            await userIsMod("AutoModerator", event.subreddit.name);
        }
    }

    return c.json<TriggerResponse>({ message: "Mod action handled." }, 200);
};
