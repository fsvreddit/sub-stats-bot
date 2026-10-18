import { TaskRequest, TaskResponse } from "@devvit/web/server";
import { Context } from "hono";
import { cleanupDeletedAccounts } from "../core";

export type CleanupDeletedAccountsJobData = {
    runDate: string;
    jobGuid: string;
};

export const handleCleanupDeletedAccountsJob = async (c: Context): Promise<Response> => {
    const event = await c.req.json<TaskRequest<CleanupDeletedAccountsJobData | undefined>>();

    await cleanupDeletedAccounts(event);

    return c.json<TaskResponse>({ message: "Cleanup deleted accounts job handled." }, 200);
};
