/**
 * messageReactionAdd.ts
 *
 * Gateway event handler for MESSAGE_REACTION_ADD.
 *
 * Checks whether the reaction was added to a message that has an active
 * paginator, and if so delegates to handleReaction() in the paginator module.
 *
 * Fluxer's MESSAGE_REACTION_ADD payload mirrors Discord pre-v9:
 * {
 *   user_id:    string
 *   channel_id: string
 *   message_id: string
 *   guild_id?:  string
 *   member?:    GuildMemberResponse
 *   emoji: {
 *     id:   string | null   (null for unicode emoji)
 *     name: string | null
 *   }
 * }
 */

import { activePaginators, handleReaction, PAGINATION_EMOJIS } from "../pagination/pagination.ts";
import type { EventParams } from "#utils/types.js";

interface ReactionAddPayload {
  user_id: string;
  channel_id: string;
  message_id: string;
  guild_id?: string;
  emoji: {
    id: string | null;
    name: string | null;
  };
}

const WATCHED_EMOJIS = new Set(Object.values(PAGINATION_EMOJIS));

export default async ({ client }: EventParams, data: ReactionAddPayload) => {
  if (!client.ready) return;

  // Ignore reactions added by the bot itself
  if (data.user_id === client.user.id) return;

  // Only care about the emoji characters we use for navigation
  const emojiName = data.emoji.name;
  if (!emojiName || !WATCHED_EMOJIS.has(emojiName as (typeof PAGINATION_EMOJIS)[keyof typeof PAGINATION_EMOJIS])) {
    return;
  }

  // Look up active paginator for this message
  const state = activePaginators.get(data.message_id);
  if (!state) return;

  // Only the original command author may control the paginator
  if (data.user_id !== state.authorId) {
    // Remove the unauthorised reaction silently
    try {
      await client.rest.delete(
        `/channels/${data.channel_id}/messages/${data.message_id}/reactions/${encodeURIComponent(emojiName)}/${data.user_id}`,
      );
    } catch {
      // ignore — bot may not have MANAGE_MESSAGES
    }
    return;
  }

  await handleReaction(state, emojiName, data.user_id);
};