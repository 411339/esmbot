import process from "node:process";
import { createPage, generateList } from "#utils/help.js";
import logger from "#utils/logger.js";
import { activityChanger, checkBroadcast } from "#utils/misc.js";
import type { EventParams, FluxerReadyData } from "#utils/types.js";

let ready = false;

export default async ({ client, database }: EventParams, data: FluxerReadyData) => {
  if (ready) return;

  // Generate help docs if OUTPUT is set
  if (process.env.OUTPUT && process.env.OUTPUT !== "") {
    generateList();
    await createPage(process.env.OUTPUT);
    logger.log("info", "The help docs have been generated.");
  }

  await checkBroadcast(client, database);
  activityChanger(client);

  ready = true;

  logger.log("info", `Started esmBot on Fluxer as @${data.user.username}#${data.user.discriminator}.`);
};