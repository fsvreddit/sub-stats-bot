import { reddit, redis } from "@devvit/web/server";

export async function userIsMod (username: string, subreddit: string): Promise<boolean> {
    const redisKey = `cachedModList`;
    const cachedModList = await redis.get(redisKey);
    if (cachedModList) {
        const modList = JSON.parse(cachedModList) as string[];
        return (modList.includes(username));
    }

    const moderators = await reddit.getModerators({ subredditName: subreddit }).all();

    await redis.set(redisKey, JSON.stringify(moderators.map(mod => mod.username)));
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
