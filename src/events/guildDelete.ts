import { info } from "#utils/logger.js";
import type { EventParams } from "#utils/types.js";

export default (_: EventParams, guild: { id: string; name?: string; unavailable?: boolean }) => {
  const name = guild.name ? `${guild.name} (${guild.id})` : guild.id;
  info(`[GUILD LEAVE] ${name} removed the bot.`);
};