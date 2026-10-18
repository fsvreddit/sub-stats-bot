import { TaskRequest, TaskResponse } from "@devvit/web/server";
import { Context } from "hono";
import { updateWikiPageAtEndOfDay } from "../core";

export type UpdateWikiPageAtEndOfDayJobData = {
    jobGuid: string;
};

export const handleUpdateWikiPageAtEndOfDayJob = async (c: Context): Promise<Response> => {
    const event = await c.req.json<TaskRequest<UpdateWikiPageAtEndOfDayJobData | undefined>>();

    await updateWikiPageAtEndOfDay(event);

    return c.json<TaskResponse>({ message: "Update wiki page at end of day job handled." }, 200);
};
