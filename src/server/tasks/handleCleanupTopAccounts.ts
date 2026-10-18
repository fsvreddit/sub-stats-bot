import { TaskResponse } from "@devvit/web/server";
import { Context } from "hono";
import { cleanupTopAccounts } from "../core";

export const handleCleanupTopAccountsJob = async (c: Context): Promise<Response> => {
    await cleanupTopAccounts();

    return c.json<TaskResponse>({ message: "Cleanup top accounts job handled." }, 200);
};
