import { ZMember } from "@devvit/public-api";
import { formatDate } from "date-fns";

export const APP_INSTALL_DATE = "appInstallDate";
export const CLEANUP_KEY = "cleanupLog";
export const SUBS_KEY = "subscriberCount";
export const WIKI_PAGE_KEY = "wikiPages";
export const WIKI_PERMISSION_LEVEL = "wikiPermissionLevel";

function datedSortedSetKey (type: string, date?: Date): string {
    return `${type}~${formatDate(date ?? new Date(), "yyyy-MM")}`;
}

export function postVotesKey (date?: Date): string {
    return datedSortedSetKey("postVotes", date);
}

export function postCountKey (date?: Date): string {
    return datedSortedSetKey("postCount", date);
}

export function commentCountKey (date?: Date): string {
    return datedSortedSetKey("commentCount", date);
}

export function userPostCountKey (date?: Date): string {
    return datedSortedSetKey("userPostCount", date);
}

export function userCommentCountKey (date?: Date): string {
    return datedSortedSetKey("userCommentCount", date);
}

export function domainCountKey (date?: Date): string {
    return datedSortedSetKey("domainCount", date);
}

export function postTypeCountKey (date?: Date): string {
    return datedSortedSetKey("postTypeCount", date);
}

export function aggregatedItems (items: ZMember[], topNByScore?: number): ZMember[] {
    const results: ZMember[] = [];
    for (const item of items) {
        const existingItem = results.find(x => x.member === item.member);
        if (existingItem) {
            existingItem.score += item.score;
        } else {
            results.push(item);
        }
    }

    if (topNByScore) {
        return results.sort((a, b) => b.score - a.score).slice(0, 5);
    } else {
        return results;
    }
}
