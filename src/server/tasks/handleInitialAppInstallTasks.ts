import { context, reddit, scheduler, TaskRequest, TaskResponse } from "@devvit/web/server";
import { Context } from "hono";
import { hasEventBeenHandled } from "@fsvreddit/fsv-devvit-web-helpers";
import { addMinutes, getYear } from "date-fns";
import json2md from "json2md";
import { SchedulerJob, storeCurrentMonthPostsOnInstall } from "../core";

export type InitialAppInstallTasksJobData = {
    jobGuid: string;
};

export const handleInitialInstallTasksJob = async (c: Context): Promise<Response> => {
    const event = await c.req.json<TaskRequest<InitialAppInstallTasksJobData>>();

    const jobGuid = event.data.jobGuid;
    if (await hasEventBeenHandled(`job:${jobGuid}`, { expiration: addMinutes(new Date(), 5) })) {
        console.warn(`Initial install job ${jobGuid} has already been handled. Skipping.`);
        return c.json<TaskResponse>({ message: `Initial install job ${jobGuid} has already been handled. Skipping.` }, 200);
    }

    await scheduler.runJob({
        name: SchedulerJob.StoreSubscriberCount,
        runAt: new Date(),
    });

    // Store upvotes for this month's top 1000 posts
    await storeCurrentMonthPostsOnInstall();

    // Create initial wiki page, and send welcome modmail
    await sendWelcomeModmail();

    return c.json<TaskResponse>({ message: "Initial app install tasks handled." }, 200);
};

async function sendWelcomeModmail () {
    const subredditName = context.subredditName;

    const message: json2md.DataObject[] = [
        { p: "Thank you for installing Subreddit Statistics!" },
        { p: "This app will start collecting statistics for your subreddit immediately, and update statistics wiki pages at 01:00 UTC every day." },
        { p: "You can find links to the statistics pages here:" },
        {
            ul: [
                `Subreddit summary page: https://www.reddit.com/r/${subredditName}/wiki/sub-stats-bot`,
                `Current year's statistics: https://www.reddit.com/r/${subredditName}/wiki/sub-stats-bot/${getYear(new Date())}`,
            ],
        },
        { p: "Current year's statistics will be not be able to report on anything other than 'top posts' until the first overnight run at 01:00 UTC, and the summary page will start to populate with useful information after two full days." },
        { p: "If you have any feedback, please send a modmail to /r/fsvapps or a message to /u/fsv. I hope you find this app useful!" },

    ];

    await reddit.modMail.createModInboxConversation({
        subredditId: context.subredditId,
        subject: "Welcome to the Subreddit Statistics Dev Platform App",
        bodyMarkdown: json2md(message),
    });

    console.log("Welcome message sent.");
}
