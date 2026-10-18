import { redis, scheduler } from "@devvit/web/server";
import { APP_INSTALL_DATE, scheduleAdhocCleanup, SchedulerJob } from ".";
import { CLEANUP_CRON } from "../core";
import { formatDate } from "date-fns";
import { InitialAppInstallTasksJobData, CalculatePostVotesJobData } from "../tasks";

export async function handleAppInstallEvents () {
    console.log("Initial install! Recording install date.");
    await redis.set(APP_INSTALL_DATE, formatDate(new Date(), "yyyy-MM-dd"));

    await scheduler.runJob<InitialAppInstallTasksJobData>({
        name: SchedulerJob.InitialInstallTasks,
        runAt: new Date(),
        data: { jobGuid: crypto.randomUUID() },
    });
}

export async function handleAppInstallUpgradeEvents () {
    console.log("Detected an install or upgrade event. Rescheduling jobs.");
    const currentJobs = await scheduler.listJobs();
    await Promise.all(currentJobs.map(job => scheduler.cancelJob(job.id)));

    // Reschedule jobs
    const randomMinute = Math.floor(Math.random() * 60);
    await scheduler.runJob({
        name: SchedulerJob.CleanupFilteredStore,
        cron: `${randomMinute} * * * *`, // Every hour
    });
    console.log(`Filtered item cleanup will run at ${randomMinute} past the hour.`);

    await scheduler.runJob({
        name: SchedulerJob.CleanupDeletedAccounts,
        cron: CLEANUP_CRON,
    });

    await scheduler.runJob({
        name: SchedulerJob.CleanupTopAccounts,
        cron: "30 23 * * *",
    });

    await scheduleAdhocCleanup();

    await scheduler.runJob({
        name: SchedulerJob.StoreSubscriberCount,
        cron: "0 0 * * *", // Once a day at midnight
    });

    await scheduler.runJob<CalculatePostVotesJobData>({
        name: SchedulerJob.CalculatePostVotes,
        data: { runMode: "yesterday" },
        cron: "1 0 * * *", // Once a day at one minute past midnight
    });

    // We also need to run the Post Votes job on the first day of the month so that the
    // first report contains meaningful scores
    await scheduler.runJob<CalculatePostVotesJobData>({
        name: SchedulerJob.CalculatePostVotes,
        data: { runMode: "today" },
        cron: "30 0 1 * *", // First day of month at 00:30
    });

    // We also should run the Post Votes job on the first few days of a month so that
    // posts made close to the end of the month have meaningful data
    await scheduler.runJob<CalculatePostVotesJobData>({
        name: SchedulerJob.CalculatePostVotes,
        data: { runMode: "lastmonth" },
        cron: "1 0 2,3,4 * *",
    });

    await scheduler.runJob({
        name: SchedulerJob.UpdateWikiPageEndDay,
        cron: "0 1 * * *", // Once a day at 1am
    });

    await scheduler.runJob({
        name: SchedulerJob.UpdateWikiPageEndYear,
        cron: "45 0 1,4 1 *", // 00:45 on 1st and 4th January each year
    });

    // On upgrade, also refresh wiki page immediately
    await scheduler.runJob({
        name: SchedulerJob.UpdateWikiPageEndDay,
        runAt: new Date(),
        data: { jobGuid: crypto.randomUUID() },
    });
}
