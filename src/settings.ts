import { SettingsFormField } from "@devvit/public-api";
import { JOB_UPDATE_WIKI_PERMISSIONS } from "./constants.js";

export enum Setting {
    IgnoreAutoMod = "ignoreAutomod",
    IgnoreModTeamUser = "ignoreModTeamUser",
    IgnoreAllModerators = "ignoreAllModerators",
    UserIgnoreList = "userIgnoreList",
    RestrictToMods = "restrictToMods",
    AddUserTags = "addUserTags",
}

export const appSettings: SettingsFormField[] = [
    {
        type: "group",
        label: "Data Capture Options",
        fields: [
            {
                name: Setting.IgnoreAutoMod,
                label: "Ignore /u/AutoModerator",
                helpText: "If ticked, post/comment statistics won't be captured for AutoModerator",
                type: "boolean",
                defaultValue: true,
            },
            {
                name: Setting.IgnoreModTeamUser,
                label: "Ignore -ModTeam user",
                helpText: "If ticked, post/comment statistics won't be captured for the subreddit's -ModTeam user",
                type: "boolean",
                defaultValue: true,
            },
            {
                name: Setting.IgnoreAllModerators,
                label: "Ignore all moderators",
                helpText: "If ticked, post/comment statistics won't be captured for any sub moderator",
                type: "boolean",
                defaultValue: false,
            },
            {
                name: Setting.UserIgnoreList,
                label: "List of other users to ignore",
                helpText: "Comma separated, not case sensitive. Specify a list of usernames to ignore when capturing statistics",
                type: "string",
            },
        ],
    },
    {
        type: "group",
        label: "Wiki Page Settings",
        fields: [
            {
                name: Setting.RestrictToMods,
                label: "Restrict wiki pages to mods only",
                helpText: "Permissions for existing wiki pages will be updated if you change this setting",
                type: "boolean",
                defaultValue: true,
                onValidate: async (_, context) => {
                    await context.scheduler.runJob({
                        name: JOB_UPDATE_WIKI_PERMISSIONS,
                        runAt: new Date(),
                    });
                },
            },
            {
                name: Setting.AddUserTags,
                label: "Add /u/ tags for usernames on wiki pages",
                type: "boolean",
                defaultValue: false,
            },
        ],
    },
];
