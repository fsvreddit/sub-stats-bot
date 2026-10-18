import type { Context } from "hono";
import { TriggerResponse } from "@devvit/web/shared";
import { handleAppInstallEvents, handleAppInstallUpgradeEvents } from "../core";

export const onAppInstall = async (c: Context): Promise<Response> => {
    console.log("App Install: Triggered");

    await handleAppInstallUpgradeEvents();
    await handleAppInstallEvents();

    return c.json<TriggerResponse>({ message: "app installed" }, 200);
};
