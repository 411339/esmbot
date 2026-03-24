import { Buffer } from "node:buffer";
import process from "node:process";
import Command from "#cmd-classes/command.js";
import MediaCommand from "#cmd-classes/mediaCommand.js";
import { aliases, commands, disabledCache, disabledCmdCache, prefixCache } from "#utils/collections.js";
import { getString } from "#utils/i18n.js";
import { error as _error, log } from "#utils/logger.js";
import { clean } from "#utils/misc.js";
import parseCommand from "#utils/parseCommand.js";
import { upload } from "#utils/tempimages.js";
import type { DBGuild, EventParams, FluxerMessage } from "#utils/types.js";

let mentionRegex: RegExp;

/**
 * Runs when a message is created on Fluxer.
 */
export default async ({ client, database }: EventParams, message: FluxerMessage) => {
  if (!client.ready) return;

  // ignore bots
  if (message.author.bot) return;

  if (!mentionRegex) mentionRegex = new RegExp(`^<@!?${client.user.id}> `);

  let guildDB: DBGuild | undefined;
  let text: string;
  const defaultPrefix = process.env.PREFIX ?? "&";
  const mentionResult = message.content.match(mentionRegex);

  if (mentionResult) {
    text = message.content.substring(mentionResult[0].length).trim();
  } else if (message.guild_id && database) {
    const cachedPrefix = prefixCache.get(message.guild_id);
    if (cachedPrefix && message.content.startsWith(cachedPrefix)) {
      text = message.content.substring(cachedPrefix.length).trim();
    } else {
      guildDB = await database.getGuild(message.guild_id);
      if (message.content.startsWith(guildDB.prefix)) {
        text = message.content.substring(guildDB.prefix.length).trim();
        prefixCache.set(message.guild_id, guildDB.prefix);
      } else {
        return;
      }
    }
  } else if (message.content.startsWith(defaultPrefix)) {
    text = message.content.substring(defaultPrefix.length).trim();
  } else if (!message.guild_id) {
    // DMs: accept without prefix
    text = message.content;
  } else {
    return;
  }

  const preArgs = text.split(/\s+/g);
  const shifted = preArgs.shift();
  if (!shifted) return;
  const cmdBaseName = shifted.toLowerCase();
  const aliased = aliases.get(cmdBaseName);
  let cmdName = aliased ?? cmdBaseName;

  const cmdBase = commands.get(cmdName);
  if (!cmdBase) return;

  let command = cmdBaseName;
  let cmd = cmdBase as typeof Command;
  if (!(cmd.prototype instanceof Command)) return;

  const parsed = parseCommand(preArgs);
  let canon = cmdName;
  if (cmdBase.baseCommand) {
    const lowerSub = parsed.args.map((v) => v.toLowerCase());
    for (const sub of lowerSub) {
      const newCanon = `${canon} ${sub}`;
      const subAlias = aliases.get(newCanon);
      const subCmd = commands.get(subAlias ?? newCanon);
      if (!subCmd) break;
      cmd = subCmd as typeof Command;
      canon = newCanon;
      parsed.args = parsed.args.slice(1);
    }
  }

  if (!cmd) return;

  // Block DM-only commands in guilds and vice versa
  if (!cmd.directAllowed && !message.guild_id) return;

  if (cmd.dbRequired && !database) {
    await client.rest.createMessage(message.channel_id, {
      content: getString("noDatabase"),
      message_reference: { message_id: message.id, fail_if_not_exists: false },
    });
    return;
  }

  // Disabled channels / commands
  if (message.guild_id && database) {
    let disabled = disabledCache.get(message.guild_id);
    if (!disabled) {
      if (!guildDB) guildDB = await database.getGuild(message.guild_id);
      disabledCache.set(message.guild_id, guildDB.disabled);
      disabled = guildDB.disabled;
    }
    if (disabled.includes(message.channel_id) && command !== "channel") return;

    let disabledCmds = disabledCmdCache.get(message.guild_id);
    if (!disabledCmds) {
      if (!guildDB) guildDB = await database.getGuild(message.guild_id);
      disabledCmdCache.set(message.guild_id, guildDB.disabled_commands);
      disabledCmds = guildDB.disabled_commands;
    }
    if (disabledCmds.includes(command) || disabledCmds.includes(cmdName) || disabledCmds.includes(canon)) return;
  }

  log("log", `${message.author.username} (${message.author.id}) ran classic command ${command}`);

  const reference = {
    message_id: message.id,
    channel_id: message.channel_id,
    guild_id: message.guild_id,
    fail_if_not_exists: false,
  };

  try {
    const startTime = new Date();
    const commandClass = new cmd(client, database, {
      type: "classic",
      cmdName: canon,
      message,
      args: parsed.args,
      content: text.replace(command, "").trim(),
      specialArgs: parsed.flags,
    });
    const result = await commandClass.run();
    const endTime = new Date();
    const allowRepliedUserMention = endTime.getTime() - startTime.getTime() >= 180000;

    const baseAllowedMentions = {
      parse: ["users"],
      replied_user: allowRepliedUserMention,
    };

    if (typeof result === "string") {
      await client.rest.createMessage(message.channel_id, {
        content: result,
        message_reference: reference,
        allowed_mentions: baseAllowedMentions,
      });
    } else if (typeof result === "object" && result !== null) {
      if (commandClass instanceof MediaCommand && "files" in result && result.files) {
        // File size limits per guild boost tier
        let fileSize = 10485760;
        const guild = message.guild_id ? client.guilds.get(message.guild_id) : undefined;
        if (guild?.premium_tier) {
          if (guild.premium_tier >= 3) fileSize = 104857600;
          else if (guild.premium_tier >= 2) fileSize = 52428800;
        }

        const file = result.files[0] as { name: string; data: Buffer };
        if (file.data.length > fileSize) {
          if (process.env.TEMPDIR && process.env.TEMPDIR !== "") {
            await upload(client, { ...file, flags: undefined }, message);
          } else {
            await client.rest.createMessage(message.channel_id, {
              content: getString("image.noTempServer"),
              message_reference: reference,
              allowed_mentions: baseAllowedMentions,
            });
          }
        } else {
          await client.rest.createMessage(message.channel_id, {
            files: [file],
            message_reference: reference,
            allowed_mentions: baseAllowedMentions,
          });
        }
      } else {
        await client.rest.createMessage(message.channel_id, {
          ...(result as object),
          message_reference: reference,
          allowed_mentions: baseAllowedMentions,
        });
      }
    }
  } catch (e) {
    const err = e as Error;
    if (err.toString().includes("Request entity too large")) {
      await client.rest.createMessage(message.channel_id, {
        content: getString("image.tooLarge"),
        message_reference: reference,
      });
    } else if (err.toString().includes("Job ended prematurely")) {
      await client.rest.createMessage(message.channel_id, {
        content: getString("image.jobEnded"),
        message_reference: reference,
      });
    } else if (err.toString().includes("Timed out")) {
      await client.rest.createMessage(message.channel_id, {
        content: getString("image.timeoutDownload"),
        message_reference: reference,
      });
    } else {
      _error(`Error occurred with command message ${message.content}: ${err.stack || err}`);
      try {
        await client.rest.createMessage(message.channel_id, {
          content: `${getString("error")} <https://github.com/esmBot/esmBot/issues>`,
          files: [{ name: "error.txt", data: Buffer.from(clean(err)) }],
          message_reference: reference,
        });
      } catch (err2) {
        _error(`While sending error message, another error occurred: ${(err2 as Error).stack || err2}`);
      }
    }
  } finally {
    if (database) {
      await database.addCount(cmdName);
    }
  }
};