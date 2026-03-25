import process from "node:process";

const [major] = process.versions.node.split(".").map(Number);
if (major < 22) {
  console.error(`You are currently running Node.js version ${process.versions.node}.
esmBot requires Node.js version 22.0.0 or above.`);
  process.exit(1);
}

import "dotenv/config";

if (!process.env.TOKEN) {
  console.error(`No token was provided!
esmBot requires a valid Fluxer bot token to function.`);
  process.exit(1);
}

import { glob, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FluxerClientImpl } from "#utils/fluxerClient.js";
import { locales, paths } from "#utils/collections.js";
import { load } from "#utils/handler.js";
import logger from "#utils/logger.js";
import { initMediaLib, reloadMediaConnections } from "#utils/media.js";
import { exit, getVers, initLog } from "#utils/misc.js";
import { parseThreshold } from "#utils/tempimages.js";
import { init as dbInit } from "./database.ts";

await getVers();
initLog();

if (!process.env.PREFIX) {
  logger.warn("No PREFIX set in .env — defaulting to '&'");
}

const database = await dbInit();
if (database) {
  const dbResult = await database.upgrade();
  if (dbResult === 1) process.exit(1);
}

if (process.env.TEMPDIR && process.env.THRESHOLD) {
  await parseThreshold();
}

const basePath = dirname(fileURLToPath(import.meta.url));

// Load locale data
logger.log("info", "Attempting to load locale data...");
for await (const localeFile of glob(resolve(basePath, "..", "locales", "*.json"))) {
  logger.log("main", `Loading locales from ${localeFile}...`);
  try {
    const commandArray = localeFile.split("/");
    const localeName = commandArray[commandArray.length - 1].split(".")[0];
    const data = await readFile(localeFile, { encoding: "utf8" });
    locales.set(localeName, JSON.parse(data));
  } catch (e) {
    logger.error(`Failed to register locales from ${localeFile}: ${e}`);
  }
}
logger.log("info", "Finished loading locale data.");

// Load commands — skip music/ and user/ and message/ categories
logger.log("info", "Attempting to load commands...");
for await (const commandFile of glob(resolve(basePath, "..", "commands", "*", "*.{js,ts}"))) {
  // Skip music commands (voice removed) and context-menu categories
  if (
    commandFile.includes("/commands/music/") ||
    commandFile.includes("/commands/user/") ||
    commandFile.includes("/commands/message/")
  ) {
    continue;
  }
  try {
    await load(commandFile);
  } catch (e) {
    logger.error(`Failed to register command from ${commandFile}: ${e}`);
  }
}
logger.log("info", "Finished loading commands.");

if (database) {
  await database.setup();
}

if (process.env.API_TYPE === "ws") {
  await reloadMediaConnections();
} else {
  await initMediaLib();
}

// Create and configure the Fluxer client.
// Intents used:
//   1 << 0  = GUILDS
//   1 << 6  = GUILD_MEMBERS          (needed so we can resolve member objects)
//   1 << 9  = GUILD_MESSAGES
//   1 << 10 = GUILD_MESSAGE_REACTIONS (needed for the reaction paginator)
//   1 << 12 = DIRECT_MESSAGES
//   1 << 13 = DIRECT_MESSAGE_REACTIONS
//   1 << 15 = MESSAGE_CONTENT        (privileged — must be enabled in the dev portal)
const INTENTS =
  (1 << 0) |
  (1 << 6) |
  (1 << 9) |
  (1 << 10) |
  (1 << 12) |
  (1 << 13) |
  (1 << 15);

const client = new FluxerClientImpl(process.env.TOKEN, INTENTS);

// Register event handlers
logger.log("info", "Attempting to load events...");
for await (const file of glob(resolve(basePath, "events", "*.{js,ts}"))) {
  // Skip events that no longer apply (interactions, voice)
  const fileName = file.split("/").pop() ?? "";
  if (
    fileName.startsWith("interactionCreate") ||
    fileName.startsWith("voiceChannel")
  ) {
    continue;
  }

  logger.log("main", `Loading event from ${file}...`);
  const eventArray = file.split("/");
  const eventName = eventArray[eventArray.length - 1].split(".")[0];
  const { default: event } = await import(file);
  client.on(eventName, event.bind(null, { client, database }));
}
logger.log("info", "Finished loading events.");

process.on("SIGINT", async () => {
  logger.info("SIGINT detected, shutting down...");
  await exit(client, database);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM detected, shutting down...");
  await exit(client, database);
});

try {
  // Add error handler to capture gateway errors
  client.on("error", (error) => {
    logger.error("Client error event:", error);
  });

  await client.connect();
  logger.info("Connecting to Fluxer gateway...");
} catch (e) {
  logger.error("esmBot failed to connect to Fluxer!");
  if (e instanceof Error) {
    logger.error(`Error message: ${e.message}`);
    logger.error(`Error stack: ${e.stack}`);
  } else {
    logger.error(e);
  }
  process.exit(1);
}