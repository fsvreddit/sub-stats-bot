import { context, reddit, redis, settings, TaskRequest, TaskResponse } from "@devvit/web/server";
import { Context } from "hono";
import { AppSetting, WIKI_PAGE_KEY, WIKI_PERMISSION_LEVEL } from "../core";
import { hasEventBeenHandled } from "@fsvreddit/fsv-devvit-web-helpers";
import { addMinutes } from "date-fns";

export type UpdateWikiPermissionsJobData = {
    jobGuid: string;
};

export const handleUpdateWikiPermissionsJob = async (c: Context): Promise<Response> => {
    const event = await c.req.json<TaskRequest<UpdateWikiPermissionsJobData | undefined>>();

    const jobGuid = event.data?.jobGuid;
    if (jobGuid && await hasEventBeenHandled(`job:${jobGuid}`, { expiration: addMinutes(new Date(), 5) })) {
        console.warn(`Wiki permissions job ${jobGuid} has already been handled. Skipping.`);
        return c.json<TaskResponse>({ message: `Wiki permissions job ${jobGuid} has already been handled. Skipping.` }, 200);
    }

    const currentPermission = await redis.get(WIKI_PERMISSION_LEVEL);
    const newPermission = await settings.get<boolean>(AppSetting.RestrictToMods);
    if (newPermission === undefined) {
        return c.json<TaskResponse>({ message: "New permission setting is undefined. Skipping." }, 200);
    }

    const newPermissionString = JSON.stringify(newPermission);

    if (currentPermission !== newPermissionString) {
        const subredditName = context.subredditName;
        const allPages = (await redis.zRange(WIKI_PAGE_KEY, 0, -1)).map(item => item.member);
        for (const page of allPages) {
            await reddit.updateWikiPageSettings({
                page,
                subredditName,
                listed: true,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment
                permLevel: newPermission ? 2 : 0,
            });
        }
        await redis.set(WIKI_PERMISSION_LEVEL, newPermissionString);
    }

    return c.json<TaskResponse>({ message: "Wiki permissions updated." }, 200);
};
