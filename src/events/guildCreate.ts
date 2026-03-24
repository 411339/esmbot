import { info } from "#utils/logger.js";
import type { EventParams, FluxerGuild } from "#utils/types.js";

export default (_: EventParams, guild: FluxerGuild) => {
  info(`[GUILD JOIN] ${guild.name} (${guild.id}) added the bot.`);
};