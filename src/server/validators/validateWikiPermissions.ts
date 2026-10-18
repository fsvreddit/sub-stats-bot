import { scheduler } from "@devvit/web/server";
import { SettingsValidationResponse } from "@devvit/web/shared";
import type { Context } from "hono";
import { SchedulerJob } from "../core";
import { UpdateWikiPermissionsJobData } from "../tasks";

export const validateWikiPermissions = async (c: Context): Promise<Response> => {
    await scheduler.runJob<UpdateWikiPermissionsJobData>({
        name: SchedulerJob.UpdateWikiPermissions,
        runAt: new Date(),
        data: { jobGuid: crypto.randomUUID() },
    });

    return c.json<SettingsValidationResponse>({
        success: true,
    });
};
