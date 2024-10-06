import { ModAction } from "@devvit/protos";
import { TriggerContext } from "@devvit/public-api";
import { handlePostOrCommentCreateOrApprove } from "./postAndCommentHandling.js";
import { userIsMod } from "./utility.js";
import { itemWasFiltered } from "./filteredStore.js";

export async function handleModAction (event: ModAction, context: TriggerContext) {
    if (event.action === "approvelink" || event.action === "approvecomment") {
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
            return;
        }

        const wasFiltered = await itemWasFiltered(targetId, context);
        if (!wasFiltered) {
            return;
        }

        await handlePostOrCommentCreateOrApprove(targetId, authorName, date, "Approved", context);
    }

    const moderatorEvents = ["acceptmoderatorinvite", "addmoderator", "removemoderator", "reordermoderators"];

    if (event.action && event.targetUser && moderatorEvents.includes(event.action)) {
        await context.redis.del("cachedModList");
        console.log(`Mod Action: Permissions for ${event.targetUser.name} changed, clearing cached mod list.`);

        // Cache mod list.
        if (event.subreddit) {
            await userIsMod("AutoModerator", event.subreddit.name, context);
        }
    }
}
