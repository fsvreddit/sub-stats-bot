import { JobContext, SettingsValues, Subreddit, TriggerContext, WikiPage, WikiPagePermissionLevel } from "@devvit/public-api";
import { aggregatedItems, APP_INSTALL_DATE, domainCountKey, postTypeCountKey, SUBS_KEY, WIKI_PAGE_KEY, WIKI_PERMISSION_LEVEL } from "./redisHelper.js";
import { addMinutes, compareDesc, differenceInDays, eachMonthOfInterval, endOfMonth, endOfYear, formatDate, getDate, getDaysInMonth, getYear, interval, isSameDay, isSameMonth, isSameYear, startOfMonth, startOfYear, subYears } from "date-fns";
import { commentCountKey, postCountKey, postVotesKey, userCommentCountKey, userPostCountKey } from "./redisHelper.js";
import { Setting } from "./settings.js";
import { estimatedNextMilestone, getSubscriberCountsByDate, getSubscriberMilestones, nextMilestone, SubscriberCount, SubscriberMilestone } from "./subscriberCount.js";
import { getSubredditName, numberWithSign } from "./utility.js";
import markdownEscape from "markdown-escape";
import pluralize from "pluralize";
import _ from "lodash";

export async function updateWikiPageAtEndOfDay (_: unknown, context: JobContext) {
    await createYearWikiPage(new Date(), context);
    await createSummaryWikiPage(context);
}

export async function updateWikiPageAtEndOfYear (_: unknown, context: JobContext) {
    await createYearWikiPage(subYears(new Date(), 1), context);
}

async function createYearWikiPage (date: Date, context: JobContext) {
    const wikiPageName = `sub-stats-bot/${formatDate(date, "yyyy")}`;
    console.log(`Updating statistics for ${getYear(date)}`);
    let wikiContent = `## ${getYear(date)}\n\n`;

    const installDateValue = await context.redis.get(APP_INSTALL_DATE);

    let firstMonth: Date;
    if (installDateValue) {
        firstMonth = _.max([startOfYear(date), startOfMonth(new Date(installDateValue))]) ?? startOfYear(date);
    } else {
        firstMonth = startOfYear(date);
    }

    const subreddit = await context.reddit.getCurrentSubreddit();
    const months = eachMonthOfInterval(interval(firstMonth, date)).sort(compareDesc);

    const settings = await context.settings.getAll();

    if (months.length > 1) {
        wikiContent += await getSummaryForYearToDate(months, settings, context);
    }

    const monthContent = await Promise.all(months.map(month => getContentForMonth(month, subreddit, settings, context)));

    for (const content of monthContent) {
        wikiContent += content;
    }

    let existingPage: WikiPage | undefined;
    try {
        existingPage = await context.reddit.getWikiPage(subreddit.name, wikiPageName);
    } catch {
        //
    }

    const wikiSaveOptions = {
        subredditName: subreddit.name,
        page: wikiPageName,
        content: wikiContent,
    };

    if (existingPage) {
        if (existingPage.content !== wikiContent) {
            await context.reddit.updateWikiPage(wikiSaveOptions);
        }
    } else {
        await context.reddit.createWikiPage(wikiSaveOptions);
    }

    console.log("Stats updated.");

    const restrictVisibilityToMods = await context.settings.get<boolean>(Setting.RestrictToMods);
    await context.reddit.updateWikiPageSettings({
        page: wikiPageName,
        subredditName: subreddit.name,
        listed: true,
        permLevel: restrictVisibilityToMods ? WikiPagePermissionLevel.MODS_ONLY : WikiPagePermissionLevel.SUBREDDIT_PERMISSIONS,
    });

    await context.redis.zAdd(WIKI_PAGE_KEY, { member: wikiPageName, score: 0 });
}

interface PostDetails {
    id: string;
    title: string;
    permalink: string;
    authorName: string;
    createdAt: Date;
    score: number;
    removed: boolean;
    removedBy?: string;
    removedByCategory?: string;
}

async function getPostDetails (postId: string, context: TriggerContext): Promise<PostDetails> {
    const redisKey = `cachedPost~${postId}`;
    const cached = await context.redis.get(redisKey);
    if (cached) {
        return JSON.parse(cached) as PostDetails;
    }

    const post = await context.reddit.getPostById(postId);
    const postDetails = {
        id: post.id,
        title: post.title,
        permalink: post.permalink,
        authorName: post.authorName,
        createdAt: post.createdAt,
        score: post.score,
        removed: post.removed,
        removedBy: post.removedBy,
        removedByCategory: post.removedByCategory,
    };

    await context.redis.set(redisKey, JSON.stringify(postDetails), { expiration: addMinutes(new Date(), 5) });
    return postDetails;
}

function formatUsername (username: string, addUserTag: boolean): string {
    if (addUserTag) {
        return `/u/${username}`;
    } else {
        return markdownEscape(username);
    }
}

async function getContentForMonth (month: Date, subreddit: Subreddit, settings: SettingsValues, context: TriggerContext): Promise<string> {
    let wikiPage = `### ${formatDate(month, "yyyy-MM")}\n\n`;

    const installDateValue = await context.redis.get(APP_INSTALL_DATE);
    if (installDateValue && isSameMonth(new Date(installDateValue), month)) {
        wikiPage += `Data collection only started on ${installDateValue}, so this month contains incomplete data.\n\n`;
    }

    if (isSameMonth(month, new Date())) {
        wikiPage += "These stats will continue to update through the end of this month.\n\n";
    }

    const firstDayOfMonth = startOfMonth(month);
    const lastDayOfMonth = endOfMonth(month);

    wikiPage += "#### Subscribers\n\n";
    const subsAtStart = await context.redis.zScore(SUBS_KEY, formatDate(firstDayOfMonth, "yyyy-MM-dd"));
    if (isSameMonth(month, new Date())) {
        // In current month, so compare start to right now, but don't show on first day.
        const currentSubs = subreddit.numberOfSubscribers;
        if (subsAtStart && !isSameDay(firstDayOfMonth, new Date())) {
            if (subsAtStart === currentSubs) {
                wikiPage += `Subscribers have remained at ${currentSubs.toLocaleString()} throughout the month\n\n`;
            } else {
                wikiPage += `Subscribers have ${currentSubs >= subsAtStart ? "increased" : "decreased"} from ${subsAtStart.toLocaleString()} at the start of the month to ${currentSubs.toLocaleString()}\n\n`;
            }
        } else {
            wikiPage += `Subscribers are now ${currentSubs.toLocaleString()}\n\n`;
        }
    } else {
        const subsAtEnd = await context.redis.zScore(SUBS_KEY, formatDate(lastDayOfMonth, "yyyy-MM-dd"));
        if (subsAtStart && subsAtEnd) {
            if (subsAtStart === subsAtEnd) {
                wikiPage += `Subscribers remained at ${subsAtStart.toLocaleString()} throughout the month\n\n`;
            } else {
                wikiPage += `Subscribers ${subsAtEnd >= subsAtStart ? "increased" : "decreased"} from ${subsAtStart.toLocaleString()} to ${subsAtEnd.toLocaleString()} by end of month.\n\n`;
            }
        } else if (subsAtEnd && !subsAtStart) {
            wikiPage += `Subscribers were ${subsAtEnd.toLocaleString()} at month end.\n\n`;
        }
    }

    wikiPage += "#### Activity\n\n";

    const todayString = formatDate(new Date(), "dd");

    let numberOfDaysCovered: number;
    if (isSameMonth(month, new Date())) {
        // Month currently in progress.
        // Are we in the same month as the app install?
        let firstDay = 1;
        if (installDateValue && isSameMonth(new Date(installDateValue), month)) {
            firstDay = getDate(new Date(installDateValue));
        }
        numberOfDaysCovered = getDate(new Date()) - firstDay;
    } else if (installDateValue && isSameMonth(month, new Date(installDateValue))) {
        numberOfDaysCovered = 1 + getDate(endOfMonth(month)) - getDate(new Date(installDateValue));
    } else {
        numberOfDaysCovered = getDaysInMonth(month);
    }

    const postsByDay = (await context.redis.zRange(postCountKey(month), 0, -1)).filter(item => !isSameMonth(month, new Date()) || (isSameMonth(month, new Date()) && item.member !== todayString));
    postsByDay.sort((a, b) => b.score - a.score);
    if (postsByDay.length > 0) {
        wikiPage += "**Posts Activity**\n\n*Most Active Days:*\n\n";
        for (const item of postsByDay.slice(0, 5)) {
            wikiPage += `* **${item.score.toLocaleString()} ${pluralize("post", item.score)}** on ${formatDate(month, "yyyy-MM")}-${item.member}\n`;
        }
        wikiPage += "\n";

        if (postsByDay.length > 1) {
            const averagePosts = Math.round(_.sum(postsByDay.map(item => item.score)) / numberOfDaysCovered);
            wikiPage += `*Average posts per day*: ${averagePosts.toLocaleString()} ${pluralize("post", averagePosts)}\n\n`;
        }
    }

    const commentsByDay = (await context.redis.zRange(commentCountKey(month), 0, -1)).filter(item => !isSameMonth(month, new Date()) || (isSameMonth(month, new Date()) && item.member !== todayString));
    commentsByDay.sort((a, b) => b.score - a.score);
    if (commentsByDay.length > 0) {
        wikiPage += "**Comments Activity**\n\n*Most Active Days:*\n\n";
        for (const item of commentsByDay.slice(0, 5)) {
            wikiPage += `* **${item.score.toLocaleString()} ${pluralize("comment", item.score)}** on ${formatDate(month, "yyyy-MM")}-${item.member}\n`;
        }
        wikiPage += "\n";

        if (commentsByDay.length > 1) {
            const averageComments = Math.round(_.sum(commentsByDay.map(item => item.score)) / numberOfDaysCovered);
            wikiPage += `*Average comments per day*: ${averageComments.toLocaleString()} ${pluralize("comment", averageComments)}\n\n`;
        }
    }

    const addUserTag = settings[Setting.AddUserTags] as boolean | undefined ?? false;

    wikiPage += "**Top Posters**\n\n";
    const topPosters = await context.redis.zRange(userPostCountKey(month), 0, 4, { by: "rank", reverse: true });

    if (topPosters.length > 0) {
        for (const user of topPosters) {
            wikiPage += `* **${user.score.toLocaleString()} ${pluralize("post", user.score)}** from ${formatUsername(user.member, addUserTag)}\n`;
        }
        // Remove zero count items.
        await context.redis.zRemRangeByScore(userPostCountKey(month), 0, 0);
        const { userCount, itemCount } = await distinctUserCount([userPostCountKey(month)], context);
        wikiPage += `\n${itemCount.toLocaleString()} ${pluralize("post", itemCount)} ${pluralize("was", itemCount)} made by ${userCount.toLocaleString()} unique ${pluralize("user", userCount)}.\n\n`;
    } else {
        wikiPage += "There were no posts made in this month.\n\n";
    }

    wikiPage += "**Top Commenters**\n\n";
    const topCommenters = await context.redis.zRange(userCommentCountKey(month), 0, 4, { by: "rank", reverse: true });

    if (topCommenters.length > 0) {
        for (const user of topCommenters) {
            wikiPage += `* **${user.score.toLocaleString()} ${pluralize("comment", user.score)}** from ${formatUsername(user.member, addUserTag)}\n`;
        }
        // Remove zero count items.
        await context.redis.zRemRangeByScore(userCommentCountKey(month), 0, 0);
        const { userCount, itemCount } = await distinctUserCount([userCommentCountKey(month)], context);
        wikiPage += `\n${itemCount.toLocaleString()} ${pluralize("comment", itemCount)} ${pluralize("was", itemCount)} made by ${userCount.toLocaleString()} unique ${pluralize("user", userCount)}.\n\n`;
    } else {
        wikiPage += "There were no comments made in this month.\n\n";
    }

    wikiPage += "**Top Posts**\n\n";
    // For top posts, we're going to get way more than we need (5) in case some are deleted or removed.
    const votesForMonth = await context.redis.zRange(postVotesKey(month), 0, 50, { by: "rank", reverse: true });
    let itemsInTopPostsList = 0;
    let topItem = votesForMonth.shift();
    while (topItem && itemsInTopPostsList < 5) {
        const postDetails = await getPostDetails(topItem.member, context);
        if (!postDetails.removed && !postDetails.removedBy && !postDetails.removedByCategory) {
            wikiPage += `* +${postDetails.score.toLocaleString()} [${markdownEscape(postDetails.title)}](${postDetails.permalink}), posted by ${formatUsername(postDetails.authorName, addUserTag)} on ${formatDate(postDetails.createdAt, "yyyy-MM-dd")}\n`;
            itemsInTopPostsList++;
        }

        topItem = votesForMonth.shift();
    }

    if (itemsInTopPostsList === 0) {
        wikiPage += "There were no posts made in this month.\n";
    }

    wikiPage += "\n";

    const domainsInMonth = await context.redis.zRange(domainCountKey(month), 0, 4, { by: "rank", reverse: true });
    if (domainsInMonth.length > 0) {
        wikiPage += "**Top Domains**\n\n";
        for (const domain of domainsInMonth) {
            wikiPage += `* **${domain.score.toLocaleString()} ${pluralize("post", domain.score)}** from ${domain.member}\n`;
        }
        wikiPage += "\n";
    }

    const postTypes = await context.redis.zRange(postTypeCountKey(month), 0, -1);
    const totalPostCount = postTypes.find(type => type.member === "total")?.score;
    if (totalPostCount && postTypes.length > 1) {
        wikiPage += "**Post Types**\n\n";
        for (const postType of postTypes.filter(type => type.member !== "total")) {
            const percentageOfWhole = Math.round(100 * (postType.score / totalPostCount));
            wikiPage += `* **${postType.member}**: ${postType.score.toLocaleString()} ${pluralize("post", postType.score)} (${percentageOfWhole}%)\n`;
        }
        wikiPage += "\n";
    }

    return wikiPage;
}

async function distinctUserCount (keys: string[], context: TriggerContext) {
    const items = _.flatten(await Promise.all(keys.map(key => context.redis.zRange(key, 0, -1))));
    const userCount = _.uniq(items.map(item => item.member)).length;
    const itemCount = _.sum(items.map(item => item.score));

    return { userCount, itemCount };
}

async function getSummaryForYearToDate (months: Date[], settings: SettingsValues, context: TriggerContext): Promise<string> {
    let wikiPage: string;
    const lastMonthInInputSet = months[0];
    if (startOfMonth(lastMonthInInputSet) < startOfMonth(new Date())) {
        // Year has finished.
        wikiPage = `Year ending ${formatDate(endOfYear(lastMonthInInputSet), "yyyy-MM-dd")}\n\n`;
    } else {
        wikiPage = `Year to date\n\n`;
    }

    const installDateVal = await context.redis.get(APP_INSTALL_DATE);
    if (installDateVal) {
        const installDate = new Date(installDateVal);
        if (isSameYear(lastMonthInInputSet, installDate)) {
            wikiPage += `Stats have been collected since ${installDateVal}\n\n`;
        }
    }

    const subredditName = await getSubredditName(context);
    wikiPage += `[Back to index page](https://www.reddit.com/r/${subredditName}/wiki/sub-stats-bot)\n\n`;

    const posters = _.flatten(await Promise.all(months.map(month => context.redis.zRange(userPostCountKey(month), 0, 99, { by: "rank", reverse: true }))));
    const top10Posters = aggregatedItems(posters, 10);

    const addUserTag = settings[Setting.AddUserTags] as boolean | undefined ?? false;

    wikiPage += "**Top Posters**\n\n";

    if (top10Posters.length > 0) {
        for (const user of top10Posters) {
            wikiPage += `* **${user.score.toLocaleString()} ${pluralize("post", user.score)}** from ${formatUsername(user.member, addUserTag)}\n`;
        }
        wikiPage += "\n";
        const { userCount, itemCount } = await distinctUserCount(months.map(month => userPostCountKey(month)), context);
        wikiPage += `${itemCount.toLocaleString()} ${pluralize("post", itemCount)} ${pluralize("was", itemCount)} made by ${userCount.toLocaleString()} distinct ${pluralize("user", userCount)}\n\n`;
    } else {
        wikiPage += "There were no posts made in this year.\n\n";
    }

    const commenters = _.flatten(await Promise.all(months.map(month => context.redis.zRange(userCommentCountKey(month), 0, 99, { by: "rank", reverse: true }))));
    const top10Commenters = aggregatedItems(commenters, 10);

    wikiPage += "**Top Commenters**\n\n";

    if (top10Commenters.length > 0) {
        for (const user of top10Commenters) {
            wikiPage += `* **${user.score.toLocaleString()} ${pluralize("comment", user.score)}** from ${formatUsername(user.member, addUserTag)}\n`;
        }
        wikiPage += "\n";
        const { userCount, itemCount } = await distinctUserCount(months.map(month => userCommentCountKey(month)), context);
        wikiPage += `${itemCount.toLocaleString()} ${pluralize("comment", itemCount)} ${pluralize("was", itemCount)} made by ${userCount.toLocaleString()} distinct ${pluralize("user", userCount)}\n\n`;
    } else {
        wikiPage += "There were no comments made this year.\n\n";
    }

    const posts = _.flatten(await Promise.all(months.map(month => context.redis.zRange(postVotesKey(month), 0, 50, { by: "rank", reverse: true }))));
    const top100Posts = aggregatedItems(posts, 100);

    if (top100Posts.length > 0) {
        wikiPage += "**Top Posts**\n\n";

        let itemsInTopPostsList = 0;
        let topItem = top100Posts.shift();
        while (topItem && itemsInTopPostsList < 10) {
            const postDetails = await getPostDetails(topItem.member, context);
            if (!postDetails.removed && !postDetails.removedBy && !postDetails.removedByCategory) {
                wikiPage += `* +${postDetails.score.toLocaleString()} [${markdownEscape(postDetails.title)}](${postDetails.permalink}), posted by ${formatUsername(postDetails.authorName, addUserTag)} on ${formatDate(postDetails.createdAt, "yyyy-MM-dd")}\n`;
                itemsInTopPostsList++;
            }

            topItem = top100Posts.shift();
        }
        wikiPage += "\n";
    } else {
        wikiPage += "There were no posts made this year.\n\n";
    }

    return wikiPage;
}

export async function createSummaryWikiPage (context: JobContext) {
    const summaryPage = "sub-stats-bot";

    const installDate = await context.redis.get(APP_INSTALL_DATE);
    const subreddit = await context.reddit.getCurrentSubreddit();

    let content = `Subreddit statistics for /r/${subreddit.name}. Statistics have been gathered since ${installDate}\n\n`;

    content += "## Detailed statistics by year\n\n";

    const existingWikiPages = (await context.redis.zRange(WIKI_PAGE_KEY, 0, -1)).map(item => item.member);
    for (const page of existingWikiPages.sort().reverse()) {
        const year = page.substring(page.length - 4);
        content += `* [${year}](https://www.reddit.com/r/${subreddit.name}/wiki/sub-stats-bot/${year})\n`;
    }
    content += "\n";

    const subscriberCounts = await context.redis.zRange(SUBS_KEY, 0, -1);
    subscriberCounts.sort((a, b) => b.member < a.member ? 1 : -1);

    content += "## Subscriber Milestones\n\n";
    const milestones = getSubscriberMilestones(subreddit, subscriberCounts);
    if (milestones.length > 1) {
        content += "| Date Reached | Subscriber Milestone | Average Daily Change | Days From Previous Milestone |\n";
        content += "|-|-|-|-|\n";

        let previousMilestone: SubscriberMilestone | undefined;
        for (const milestone of milestones) {
            content += `| ${milestone.date} | ${milestone.milestoneCrossed?.toLocaleString() ?? "Created"} | `;
            if (previousMilestone && milestone.subscriberCount && previousMilestone.subscriberCount) {
                const daysBetween = differenceInDays(new Date(milestone.date), new Date(previousMilestone.date));
                const dailyChange = Math.round((milestone.subscriberCount - previousMilestone.subscriberCount) / daysBetween);
                content += `${numberWithSign(dailyChange)} | ${daysBetween.toLocaleString()}`;
            } else {
                content += "--- | --- |";
            }
            previousMilestone = milestone;
            content += "\n";
        }
        content += "\n";
    } else {
        content += "There have been no milestones crossed since the app was installed. ";
    }
    const nextMilestoneDistance = estimatedNextMilestone(subreddit, subscriberCounts);
    content += `Next milestone: ${nextMilestone(subreddit.numberOfSubscribers).toLocaleString()}.`;
    if (nextMilestoneDistance) {
        content += ` This will be reached in ${nextMilestoneDistance} based on recent growth rates.`;
    }
    content += "\n\n";

    // If we have captured more than two subscriber counts, create subscriber count table.
    content += "## Subscriber Counts\n\n";
    const subscriberCountRecords = getSubscriberCountsByDate(subscriberCounts);
    if (subscriberCountRecords.counts.length > 2) {
        console.log("Building subscriber stats page");
        // Build a table of subscriber counts.
        if (subscriberCountRecords.granularity === "day") {
            content += "| Date | Subscribers | Change |\n";
            content += "|-|-|-|\n";
        } else {
            content += "| Date | Subscribers | Change | Average daily change |\n";
            content += "|-|-|-|-|\n";
        }

        const tableRows: string[] = [];
        let item = subscriberCountRecords.counts.shift();
        let previousItem: SubscriberCount | undefined;
        while (item) {
            let newRow = `| ${item.date} | ${item.subscriberCount.toLocaleString()} | `;
            if (previousItem) {
                const dailyChange = item.subscriberCount - previousItem.subscriberCount;
                newRow += `${numberWithSign(dailyChange)} |`;
                if (subscriberCountRecords.granularity !== "day") {
                    newRow += ` ${numberWithSign(Math.round(dailyChange / differenceInDays(new Date(item.date), new Date(previousItem.date))))} |`;
                }
            } else {
                // Oldest row.
                newRow += "--- |";
                if (subscriberCountRecords.granularity !== "day") {
                    newRow += " --- |";
                }
            }
            tableRows.unshift(newRow);
            previousItem = item;
            item = subscriberCountRecords.counts.shift();
        }

        content += tableRows.join("\n");
        content += "\n\n";
    } else {
        content += "Subscriber count history will be shown here once the app has been installed for two full days.\n\n";
    }

    let existingPage: WikiPage | undefined;
    try {
        existingPage = await context.reddit.getWikiPage(subreddit.name, summaryPage);
    } catch {
        //
    }

    const wikiSaveOptions = {
        subredditName: subreddit.name,
        page: summaryPage,
        content,
    };

    if (existingPage) {
        if (existingPage.content !== content) {
            await context.reddit.updateWikiPage(wikiSaveOptions);
        }
    } else {
        await context.reddit.createWikiPage(wikiSaveOptions);
    }

    console.log("Summary Stats updated.");

    const restrictVisibilityToMods = await context.settings.get<boolean>(Setting.RestrictToMods);
    await context.reddit.updateWikiPageSettings({
        page: summaryPage,
        subredditName: subreddit.name,
        listed: true,
        permLevel: restrictVisibilityToMods ? WikiPagePermissionLevel.MODS_ONLY : WikiPagePermissionLevel.SUBREDDIT_PERMISSIONS,
    });
}

export async function updateWikiPagePermissions (_: unknown, context: JobContext) {
    const currentPermission = await context.redis.get(WIKI_PERMISSION_LEVEL);
    const newPermission = await context.settings.get<boolean>(Setting.RestrictToMods);
    if (newPermission === undefined) {
        return;
    }

    const newPermissionString = JSON.stringify(newPermission);

    if (currentPermission !== newPermissionString) {
        const subredditName = await getSubredditName(context);
        const allPages = (await context.redis.zRange(WIKI_PAGE_KEY, 0, -1)).map(item => item.member);
        for (const page of allPages) {
            await context.reddit.updateWikiPageSettings({
                page,
                subredditName,
                listed: true,
                permLevel: newPermission ? WikiPagePermissionLevel.MODS_ONLY : WikiPagePermissionLevel.SUBREDDIT_PERMISSIONS,
            });
        }
        await context.redis.set(WIKI_PERMISSION_LEVEL, newPermissionString);
    }
}
