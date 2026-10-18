import { TaskResponse } from "@devvit/web/server";
import { Context } from "hono";
import { updateWikiPageAtEndOfYear } from "../core";

export const handleUpdateWikiPageAtEndOfYearJob = async (c: Context): Promise<Response> => {
    await updateWikiPageAtEndOfYear();

    return c.json<TaskResponse>({ message: "Update wiki page at end of year job handled." }, 200);
};
