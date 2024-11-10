import { JobContext, JSONObject, ScheduledJobEvent, TriggerContext, ZMember } from "@devvit/public-api";
import { domainCountKey, postTypeCountKey, postVotesKey } from "./redisHelper.js";
import { addSeconds, getDate, startOfMonth, subDays, subMonths } from "date-fns";
import { domainFromUrlString, getSubredditName } from "./utility.js";
import { JOB_CALCULATE_POST_VOTES } from "./constants.js";
import pluralize from "pluralize";
import _ from "lodash";

type PostType = "self" | "nsfw" | "spoiler" | "total";
type RunMode = "today" | "yesterday" | "lastmonth";

export async function calculatePostVotes (event: ScheduledJobEvent<JSONObject | undefined>, context: JobContext) {
    const runMode = event.data?.runMode as RunMode | undefined ?? "yesterday";
    let checkDate: Date;

    switch (runMode) {
        case "today":
            checkDate = new Date();
            break;
        case "yesterday":
            checkDate = subDays(new Date(), 1);
            break;
        case "lastmonth":
            checkDate = subMonths(new Date(), 1);
            break;
    }

    const redisKey = postVotesKey(checkDate);

    let postsToCheck: string[];
    const newScores: ZMember[] = [];
    const postTypes: Record<PostType, number> = {
        nsfw: 0,
        self: 0,
        spoiler: 0,
        total: 0,
    };

    const domains: Record<string, number> = {};

    if (event.data?.postIds) {
        postsToCheck = event.data.postIds as string[];
        console.log(`Post Votes: Checking ${postsToCheck.length} ${pluralize("post", newScores.length)} on job second run`);
    } else {
        // First check in the day. Get scores by getTopPosts and remove post type counts
        await context.redis.del(postTypeCountKey(checkDate));
        await context.redis.del(domainCountKey(checkDate));

        postsToCheck = (await context.redis.zRange(redisKey, 0, -1)).map(item => item.member);
        if (postsToCheck.length === 0) {
            console.log("Post Votes: No posts this month.");
            return;
        }

        console.log(`Post Votes: Checking ${postsToCheck.length} ${pluralize("post", newScores.length)} on job first run`);

        // Because this is the first check on this day, attempt to get scores via getTopPosts.
        const subPosts = await context.reddit.getTopPosts({
            subredditName: await getSubredditName(context),
            timeframe: getDate(checkDate) < 7 ? "week" : "month",
            limit: 1000,
        }).all();

        for (const postId of postsToCheck) {
            const post = subPosts.find(x => x.id === postId);
            if (post) {
                newScores.push({ member: postId, score: post.score });
                if (post.nsfw) {
                    postTypes.nsfw++;
                }
                if (post.spoiler) {
                    postTypes.spoiler++;
                }
                if (post.url.includes(post.permalink)) {
                    postTypes.self++;
                }
                postTypes.total++;

                if (post.url && !post.url.includes(post.permalink)) {
                    const domain = domainFromUrlString(post.url);
                    const existingDomainCount = domains[domain] ?? 0;
                    domains[domain] = existingDomainCount + 1;
                }
            }
        }

        // Remove entries for posts we now have scores ready for.
        postsToCheck = postsToCheck.filter(postId => !newScores.some(item => item.member === postId));
        console.log(`Post Votes: Grabbed scores for ${newScores.length} ${pluralize("post", newScores.length)} from Top Posts list`);
    }

    let itemsCheckedIndividually = 0;

    // Process up to 50 posts in a batch.
    let postId = postsToCheck.shift();
    while (postId && itemsCheckedIndividually < 50) {
        const post = await context.reddit.getPostById(postId);
        newScores.push({ member: postId, score: post.score });

        if (post.nsfw) {
            postTypes.nsfw++;
        }
        if (post.spoiler) {
            postTypes.spoiler++;
        }
        if (post.url.includes(post.permalink)) {
            postTypes.self++;
        }
        postTypes.total++;
        if (post.url && !post.url.includes(post.permalink)) {
            try {
                const domain = domainFromUrlString(post.url);
                const existingDomainCount = domains[domain] ?? 0;
                domains[domain] = existingDomainCount + 1;
            } catch (error) {
                console.log(post.id);
                console.log(error);
            }
        }

        itemsCheckedIndividually++;
        postId = postsToCheck.shift();
    }

    // Store the new post scores.
    if (newScores.length > 0) {
        await context.redis.zAdd(redisKey, ...newScores);
        console.log(`Post Votes: Stored scores for ${newScores.length} ${pluralize("post", newScores.length)}`);
    }

    await context.redis.zIncrBy(postTypeCountKey(checkDate), "nsfw", postTypes.nsfw);
    await context.redis.zIncrBy(postTypeCountKey(checkDate), "spoiler", postTypes.spoiler);
    await context.redis.zIncrBy(postTypeCountKey(checkDate), "self", postTypes.self);
    await context.redis.zIncrBy(postTypeCountKey(checkDate), "total", postTypes.total);

    for (const item of _.toPairs(domains)) {
        const [domain, count] = item;
        if (domain === "reddit.com" || domain === "i.redd.it" || domain === "v.redd.it") {
            continue;
        }
        await context.redis.zIncrBy(domainCountKey(checkDate), domain, count);
    }

    if (postsToCheck.length > 0) {
        // Schedule another run, still got posts to check.
        console.log(`Post Votes: Scores for ${postsToCheck.length} ${pluralize("post", newScores.length)} still needed. Queuing further check.`);
        await context.scheduler.runJob({
            name: JOB_CALCULATE_POST_VOTES,
            data: { postIds: postsToCheck, runMode },
            runAt: addSeconds(new Date(), 30),
        });
    }
}

export async function storeCurrentMonthPostsOnInstall (context: TriggerContext) {
    const subredditName = await getSubredditName(context);
    const posts = await context.reddit.getTopPosts({
        subredditName,
        timeframe: getDate(new Date()) < 7 ? "week" : "month",
        limit: 1000,
    }).all();

    const thisMonthsPosts = posts.filter(post => post.createdAt > startOfMonth(new Date()));
    if (thisMonthsPosts.length === 0) {
        return;
    }

    const redisKey = postVotesKey();

    await context.redis.zAdd(redisKey, ...thisMonthsPosts.map(post => ({ member: post.id, score: post.score })));
    console.log(`Post Votes: Scores for ${thisMonthsPosts.length} ${pluralize("post", thisMonthsPosts.length)} stored on first install.`);
}
