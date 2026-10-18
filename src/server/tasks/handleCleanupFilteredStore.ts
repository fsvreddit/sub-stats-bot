import { TaskResponse } from "@devvit/web/server";
import { Context } from "hono";
import { cleanupFilteredStore } from "../core";

export const handleCleanupFilteredStoreJob = async (c: Context): Promise<Response> => {
    await cleanupFilteredStore();

    return c.json<TaskResponse>({ message: "Cleanup of filtered store completed." }, 200);
};
