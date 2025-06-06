import { JobContext, TriggerContext } from "@devvit/public-api";
import { AppInstall, AppUpgrade } from "@devvit/protos";
import { APP_INSTALL_DATE } from "./redisHelper.js";
import { storeCurrentMonthPostsOnInstall } from "./postCalculations.js";
import { CLEANUP_CRON, JOB_CALCULATE_POST_VOTES, JOB_CLEANUP_DELETED_USER, JOB_CLEANUP_FILTERED_STORE, JOB_CLEANUP_TOP_ACCOUNTS, JOB_INITIAL_INSTALL_TASKS, JOB_STORE_SUBSCRIBER_COUNT, JOB_UPDATE_WIKI_PAGE_END_DAY, JOB_UPDATE_WIKI_PAGE_END_YEAR } from "./constants.js";
import { formatDate, getYear } from "date-fns";
import { scheduleAdhocCleanup } from "./cleanup.js";
import { storeSubscriberCount } from "./subscriberCount.js";
import json2md from "json2md";

export async function handleAppInstallEvents (_: AppInstall, context: TriggerContext) {
    console.log("Initial install! Recording install date.");
    await context.redis.set(APP_INSTALL_DATE, formatDate(new Date(), "yyyy-MM-dd"));

    await context.scheduler.runJob({
        name: JOB_INITIAL_INSTALL_TASKS,
        runAt: new Date(),
    });
}

export async function handleAppInstallUpgradeEvents (_: AppInstall | AppUpgrade, context: TriggerContext) {
    console.log("Detected an install or upgrade event. Rescheduling jobs.");
    const currentJobs = await context.scheduler.listJobs();
    await Promise.all(currentJobs.map(job => context.scheduler.cancelJob(job.id)));

    // Reschedule jobs
    const randomMinute = Math.floor(Math.random() * 60);
    await context.scheduler.runJob({
        name: JOB_CLEANUP_FILTERED_STORE,
        cron: `${randomMinute} * * * *`, // Every hour
    });
    console.log(`Filtered item cleanup will run at ${randomMinute} past the hour.`);

    await context.scheduler.runJob({
        name: JOB_CLEANUP_DELETED_USER,
        cron: CLEANUP_CRON,
    });

    await context.scheduler.runJob({
        name: JOB_CLEANUP_TOP_ACCOUNTS,
        cron: "30 23 * * *",
    });

    await scheduleAdhocCleanup(context);

    await context.scheduler.runJob({
        name: JOB_STORE_SUBSCRIBER_COUNT,
        cron: "0 0 * * *", // Once a day at midnight
    });

    await context.scheduler.runJob({
        name: JOB_CALCULATE_POST_VOTES,
        data: { runMode: "yesterday" },
        cron: "1 0 * * *", // Once a day at one minute past midnight
    });

    // We also need to run the Post Votes job on the first day of the month so that the
    // first report contains meaningful scores
    await context.scheduler.runJob({
        name: JOB_CALCULATE_POST_VOTES,
        data: { runMode: "today" },
        cron: "30 0 1 * *", // First day of month at 00:30
    });

    // We also should run the Post Votes job on the first few days of a month so that
    // posts made close to the end of the month have meaningful data
    await context.scheduler.runJob({
        name: JOB_CALCULATE_POST_VOTES,
        data: { runMode: "lastmonth" },
        cron: "1 0 2,3,4 * *",
    });

    await context.scheduler.runJob({
        name: JOB_UPDATE_WIKI_PAGE_END_DAY,
        cron: "0 1 * * *", // Once a day at 1am
    });

    await context.scheduler.runJob({
        name: JOB_UPDATE_WIKI_PAGE_END_YEAR,
        cron: "45 0 1,4 1 *", // 00:45 on 1st and 4th January each year
    });

    // On upgrade, also refresh wiki page immediately
    await context.scheduler.runJob({
        name: JOB_UPDATE_WIKI_PAGE_END_DAY,
        runAt: new Date(),
    });
}

export async function handleInitialAppInstallTasks (_: unknown, context: JobContext) {
    // Store initial subscriber count
    await storeSubscriberCount(undefined, context);

    // Store upvotes for this month's top 1000 posts
    await storeCurrentMonthPostsOnInstall(context);

    // Create initial wiki page, and send welcome modmail
    await sendWelcomeModmail(context);
}

async function sendWelcomeModmail (context: TriggerContext) {
    const subredditName = context.subredditName ?? await context.reddit.getCurrentSubredditName();

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

    await context.reddit.modMail.createModInboxConversation({
        subredditId: context.subredditId,
        subject: "Welcome to the Subreddit Statistics Dev Platform App",
        bodyMarkdown: json2md(message),
    });

    console.log("Welcome message sent.");
}
