import type { Context } from "hono";
import { TriggerResponse } from "@devvit/web/shared";
import { handleAppInstallUpgradeEvents } from "../core";

export const onAppUpgrade = async (c: Context): Promise<Response> => {
    console.log("App Upgrade: Triggered");

    await handleAppInstallUpgradeEvents();

    return c.json<TriggerResponse>({ message: "app upgraded" }, 200);
};
