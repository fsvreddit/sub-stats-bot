import { TaskRequest, TaskResponse } from "@devvit/web/server";
import { T3 } from "@devvit/web/shared";
import { Context } from "hono";
import { calculatePostVotes, RunMode } from "../core";

export type CalculatePostVotesJobData = {
    jobGuid?: string;
    runMode: RunMode;
    postIds?: T3[];
};

export const handleCalculatePostVotesJob = async (c: Context): Promise<Response> => {
    const event = await c.req.json<TaskRequest<CalculatePostVotesJobData | undefined>>();

    await calculatePostVotes(event);

    return c.json<TaskResponse>({ message: "Calculate post votes job handled." }, 200);
};
