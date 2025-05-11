import { JobContext, ScheduledJobEvent, Subreddit, ZMember } from "@devvit/public-api";
import { SUBS_KEY } from "./redisHelper.js";
import { addDays, differenceInDays, formatDate, formatDistance, getDate, isMonday, subDays } from "date-fns";

export async function storeSubscriberCount (_: ScheduledJobEvent<undefined> | undefined, context: JobContext) {
    const subreddit = await context.reddit.getCurrentSubreddit();
    await context.redis.zAdd(SUBS_KEY, { member: formatDate(new Date(), `yyyy-MM-dd`), score: subreddit.numberOfSubscribers });
    console.log(`Subscriber count stored. Value: ${subreddit.numberOfSubscribers}`);
}

export interface SubscriberMilestone {
    date: string;
    milestoneCrossed?: number;
    subscriberCount?: number;
}

export function nextMilestone (input: number): number {
    if (input < 100) {
        return 100;
    }

    // Special case for hundreds - return every hundredth rather than every 50th
    if (input < 1000) {
        return (100 * Math.floor(input / 100)) + 100;
    }

    const doubleInput = input * 2;
    const roundedLog = Math.floor(Math.log10(input));
    const multiplier = Math.pow(10, roundedLog);
    const newVal = multiplier + multiplier * Math.floor(doubleInput / multiplier);

    return newVal / 2;
}

export function isMilestoneCrossed (left: number, right: number): number | undefined {
    let milestoneToCross = nextMilestone(left);
    while (right > milestoneToCross) {
        const next = nextMilestone(milestoneToCross);
        if (next > right) {
            return milestoneToCross;
        }
        milestoneToCross = next;
    }
}

export function getSubscriberMilestones (subreddit: Subreddit, subscriberCounts: ZMember[]): SubscriberMilestone[] {
    const milestones: SubscriberMilestone[] = [{ date: formatDate(subreddit.createdAt, "yyyy-MM-dd") }];

    // Grab the earliest count found and use that as the baseline
    let lastMilestone = subscriberCounts.shift()?.score;
    if (lastMilestone) {
        for (const subCount of subscriberCounts) {
            const milestoneCrossed = isMilestoneCrossed(lastMilestone, subCount.score);
            if (milestoneCrossed && !milestones.some(item => item.milestoneCrossed === milestoneCrossed)) {
                milestones.unshift({ date: subCount.member, milestoneCrossed, subscriberCount: subCount.score });
                lastMilestone = milestoneCrossed;
            }
        }
    }

    return milestones;
}

export interface SubscriberCount {
    date: string;
    subscriberCount: number;
}

interface SubscriberCountRecords {
    counts: SubscriberCount[];
    granularity: string;
}

export function getSubscriberCountsByDate (subscriberCounts: ZMember[]): SubscriberCountRecords {
    let granularity: string;
    if (subscriberCounts.length > 28 && subscriberCounts.length < 160) {
        // Filter down to one per week
        subscriberCounts = subscriberCounts.filter(item => isMonday(new Date(item.member)));
        granularity = "week";
    } else if (subscriberCounts.length >= 160) {
        // Filter down to one per month
        subscriberCounts = subscriberCounts.filter(item => getDate(new Date(item.member)) === 1);
        granularity = "month";
    } else {
        granularity = "day";
    }

    return {
        counts: subscriberCounts.map(item => ({ date: item.member, subscriberCount: item.score })),
        granularity,
    };
}

export function estimatedNextMilestone (subreddit: Subreddit, subscriberCounts: ZMember[]): string | undefined {
    if (subscriberCounts.length === 0) {
        return;
    }
    // Find the subscriber count for two weeks ago, or the oldest
    // one that exists if we have less than two weeks worth of data
    const baseline = subscriberCounts.find(item => item.member === formatDate(subDays(new Date(), 14), "yyyy-MM-dd")) ?? subscriberCounts[0];

    const differenceInSubs = subreddit.numberOfSubscribers - baseline.score;
    if (differenceInSubs <= 0) {
        // Subscribers are going down or are unchanged
        return;
    }

    const nextMilestoneToCross = nextMilestone(subreddit.numberOfSubscribers);

    const daysBeforeNextMilestone = (nextMilestoneToCross - subreddit.numberOfSubscribers) / (differenceInSubs / differenceInDays(new Date(), new Date(baseline.member)));
    if (daysBeforeNextMilestone < 1) {
        return "less than a day";
    }

    return formatDistance(addDays(new Date(), daysBeforeNextMilestone), new Date());
}
