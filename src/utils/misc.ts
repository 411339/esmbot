import { execFile as baseExecFile } from "node:child_process";
import process from "node:process";
import util, { promisify } from "node:util";
import { config, type DotenvParseOutput } from "dotenv";
import commandsConfig from "#config/commands.json" with { type: "json" };
import packageJson from "../../package.json" with { type: "json" };
import type { DatabasePlugin } from "../database.ts";
import type { FluxerClient, FluxerMessage } from "./types.ts";
import { disconnect, servers } from "./media.ts";

export async function getVers() {
  process.env.ESMBOT_VER = packageJson.version;
  const execFile = promisify(baseExecFile);

  process.env.GIT_REV = await execFile("git", ["rev-parse", "HEAD"]).then(
    (output) => output.stdout.substring(0, 7),
    () => "unknown commit",
  );
}

export function initLog() {
  console.log(`
     ,*\`$                    z\`"v
    F zBw\`%                 A ,W "W
  ,\` ,EBBBWp"%. ,-=~~==-,+*  4BBE  T
  M  BBBBBBBB* ,w=####Wpw  4BBBBB#  1
 F  BBBBBBBMwBBBBBBBBBBBBB#wXBBBBBH  E
 F  BBBBBBkBBBBBBBBBBBBBBBBBBBBE4BL  k
 #  BFBBBBBBBBBBBBF"      "RBBBW    F
  V ' 4BBBBBBBBBBM            TBBL  F
   F  BBBBBBBBBBF              JBB  L
   F  FBBBBBBBEB                BBL 4
   E  [BB4BBBBEBL               BBL 4
   I   #BBBBBBBEB              4BBH  *w
   A   4BBBBBBBBBEW,         ,BBBB  W  [
.A  ,k  4BBBBBBBBBBBEBW####BBBBBBM BF  F
k  <BBBw BBBBEBBBBBBBBBBBBBBBBBQ4BM  #
 5,  REBBB4BBBBB#BBBBBBBBBBBBP5BFF  ,F
   *w  \`*4BBW\`"FF#F##FFFF"\` , *   +"
      *+,   " F'"'*^~~~^"^\`  V+*^
          \`"""

esmBot ${process.env.ESMBOT_VER} (${process.env.GIT_REV}) — Fluxer edition
`);
}

export function random<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

const optionalReplace = (token: string) => {
  return token === undefined || token === "" ? "" : token === "true" || token === "false" ? token : "<redacted>";
};

export function clean(input: string | Error, remove: string[] = [], skipEnv = false): string {
  let text = input;
  if (typeof text !== "string") text = util.inspect(text, { depth: 1 });

  for (const entry of remove) {
    text = text.replaceAll(entry, optionalReplace(entry));
  }

  text = text.replaceAll("`", `\`${String.fromCharCode(8203)}`).replaceAll("@", `@${String.fromCharCode(8203)}`);

  if (!skipEnv) {
    let { parsed } = config({ quiet: true });
    if (!parsed) parsed = process.env as DotenvParseOutput;

    if (servers?.length !== 0) {
      for (const { server, auth } of servers) {
        text = text.replaceAll(server, optionalReplace(server));
        if (auth) text = text.replaceAll(auth, optionalReplace(auth));
      }
    }

    for (const env of Object.keys(parsed)) {
      text = text.replaceAll(parsed[env], optionalReplace(parsed[env]));
    }
  }

  return text;
}

export function textEncode(string: string): string {
  return string
    .replaceAll("&", "&amp;")
    .replaceAll(">", "&gt;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\\n", "\n")
    .replaceAll("\\:", ":")
    .replaceAll("\\,", ",");
}

let broadcast = false;

export async function checkBroadcast(client: FluxerClient, db: DatabasePlugin | undefined) {
  if (!db) return;
  const message = await db.getBroadcast();
  if (message) startBroadcast(client, message);
}

export function startBroadcast(client: FluxerClient, message: string) {
  client.editStatus("dnd", [{ type: 0, name: message }]);
  broadcast = true;
}

export function endBroadcast(client: FluxerClient) {
  // Reset to default status
  client.editStatus("online", []);
  broadcast = false;
}

export async function exit(client: FluxerClient, database: DatabasePlugin | undefined) {
  client.disconnect(false);
  if (database) await database.stop();
  disconnect();
  process.exit();
}

export function getServers(client: FluxerClient): number {
  return client.guilds.size;
}

/** Clean a message's text content (remove mention noise, encode for image processing) */
export function cleanMessage(message: FluxerMessage, content: string): string {
  let cleanContent = content?.replace(/<a?(:\w+:)[0-9]+>/g, "$1") || "";

  const author = message.author;
  let authorName = author.username;
  if (message.member?.nick) {
    authorName = message.member.nick;
  }
  cleanContent = cleanContent.replace(new RegExp(`<@!?${author.id}>`, "g"), `@${authorName}`);

  if (message.mentions) {
    for (const mention of message.mentions) {
      cleanContent = cleanContent.replace(new RegExp(`<@!?${mention.id}>`, "g"), `@${mention.username}`);
    }
  }

  if (message.mention_roles) {
    // We don't have role name resolution here — just strip the mention tags
    for (const roleId of message.mention_roles) {
      cleanContent = cleanContent.replace(new RegExp(`<@&${roleId}>`, "g"), `@role`);
    }
  }

  return textEncode(cleanContent);
}

export function isEmpty(string: string): boolean {
  return string.length === 0 || string.replace(/[\s\u2800\p{C}]/gu, "").length === 0;
}

export function safeBigInt(input: string | number | bigint | boolean): bigint {
  try {
    return BigInt(input);
  } catch {
    return -1n;
  }
}