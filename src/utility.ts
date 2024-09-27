import { TriggerContext } from "@devvit/public-api";

export enum ThingPrefix {
    Comment = "t1_",
    Account = "t2_",
    Post = "t3_",
    Message = "t4_",
    Subreddit = "t5_",
    Award = "t6_",
}

export async function userIsMod (username: string, subreddit: string, context: TriggerContext): Promise<boolean> {
    const redisKey = `cachedModList`;
    const cachedModList = await context.redis.get(redisKey);
    if (cachedModList) {
        const modList = JSON.parse(cachedModList) as string[];
        return (modList.includes(username));
    }

    const moderators = await context.reddit.getModerators({ subredditName: subreddit }).all();

    await context.redis.set(redisKey, JSON.stringify(moderators.map(mod => mod.username)));
    return moderators.some(mod => mod.username === username);
}

export function domainFromUrlString (url: string): string {
    if (url.startsWith("/")) {
        return "reddit.com";
    }

    try {
        const hostname = new URL(url).hostname;
        if (hostname.startsWith("www.")) {
            return hostname.substring(4);
        }
        return hostname;
    } catch (error) {
        console.log(`Error parsing domain from URL. Input: ${url}`);
        throw error;
    }
}

export function numberWithSign (input: number): string {
    return (input > 0 ? "+" : "") + input.toLocaleString();
}
