/**
 * pagination.ts
 *
 * Reaction-based paginator for Fluxer (no interaction/button support yet).
 *
 * Adds four reactions to the paginator message:
 *   ⏮  — jump to first page
 *   ◀  — previous page
 *   ▶  — next page
 *   ⏭  — jump to last page
 *   🗑  — delete the message
 *
 * When the bot detects one of these reactions from the original command author,
 * it removes their reaction immediately so they can re-use the same emoji to
 * navigate further, then edits the message to the new page.
 *
 * The collector times out after 2 minutes of inactivity and disables itself
 * by removing all reactions from the message.
 */

import type { CreateMessageData, FluxerClient, FluxerMessage, FluxerUser } from "../utils/types.ts";
import logger from "../utils/logger.ts";

const EMOJIS = {
  FIRST: "⏮",
  BACK: "◀",
  FORWARD: "▶",
  LAST: "⏭",
  DELETE: "🗑",
} as const;

const EMOJI_LIST = Object.values(EMOJIS);

type Page = CreateMessageData;

type PaginatorInfo = {
  author: FluxerUser;
  message?: FluxerMessage;
};

// Global registry of active paginators keyed by paginator message ID.
// The event handler in messageReactionAdd looks up entries here.
export const activePaginators = new Map<string, PaginatorState>();

export type PaginatorState = {
  pages: Page[];
  page: number;
  authorId: string;
  channelId: string;
  messageId: string;
  client: FluxerClient;
  timeout: ReturnType<typeof setTimeout>;
  /** Call this to tear down the paginator (removes reactions, cleans up map). */
  destroy: (deleteMessage?: boolean) => Promise<void>;
};

async function addReactions(client: FluxerClient, channelId: string, messageId: string) {
  for (const emoji of EMOJI_LIST) {
    try {
      await client.rest.post(`/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
      // Small delay to avoid hitting rate limits when adding reactions in bulk
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      logger.warn(`Failed to add reaction ${emoji} to message ${messageId}: ${e}`);
    }
  }
}

async function removeUserReaction(
  client: FluxerClient,
  channelId: string,
  messageId: string,
  emoji: string,
  userId: string,
) {
  try {
    await client.rest.delete(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/${userId}`,
    );
  } catch (e) {
    logger.warn(`Failed to remove reaction ${emoji} from user ${userId}: ${e}`);
  }
}

async function removeAllReactions(client: FluxerClient, channelId: string, messageId: string) {
  try {
    await client.rest.delete(`/channels/${channelId}/messages/${messageId}/reactions`);
  } catch {
    // Message may have been deleted already — ignore
  }
}

export default async function paginator(
  client: FluxerClient,
  info: PaginatorInfo,
  pages: Page[],
): Promise<undefined> {
  if (pages.length === 0) return;

  // Send or reply with the first page
  let currentPage: FluxerMessage;
  try {
    if (info.message) {
      currentPage = await client.rest.createMessage(info.message.channel_id, {
        ...pages[0],
        message_reference: {
          message_id: info.message.id,
          channel_id: info.message.channel_id,
          guild_id: info.message.guild_id,
          fail_if_not_exists: false,
        },
        allowed_mentions: { replied_user: false },
      });
    } else {
      throw new Error("No message context provided to paginator");
    }
  } catch (e) {
    logger.error(`Paginator failed to send initial message: ${e}`);
    return;
  }

  // If there's only one page there's nothing to paginate — don't add reactions
  if (pages.length === 1) return;

  // Add navigation reactions
  await addReactions(client, currentPage.channel_id, currentPage.id);

  let currentPageIndex = 0;

  const destroy = async (deleteMsg = false) => {
    activePaginators.delete(currentPage.id);
    clearTimeout(state.timeout);
    if (deleteMsg) {
      try {
        await client.rest.deleteMessage(currentPage.channel_id, currentPage.id);
      } catch {
        // already deleted
      }
    } else {
      await removeAllReactions(client, currentPage.channel_id, currentPage.id);
    }
  };

  const resetTimeout = () => {
    clearTimeout(state.timeout);
    state.timeout = setTimeout(() => {
      destroy(false);
    }, 120_000);
  };

  const state: PaginatorState = {
    pages,
    page: currentPageIndex,
    authorId: info.author.id,
    channelId: currentPage.channel_id,
    messageId: currentPage.id,
    client,
    timeout: setTimeout(() => destroy(false), 120_000),
    destroy,
  };

  activePaginators.set(currentPage.id, state);

  // The actual reaction handling is done in src/events/messageReactionAdd.ts
  // which looks up the paginator state from activePaginators and calls
  // handleReaction() below.
  return;
}

/**
 * Called by the messageReactionAdd event handler when a reaction is added
 * to a message that has an active paginator.
 */
export async function handleReaction(
  state: PaginatorState,
  emoji: string,
  userId: string,
): Promise<void> {
  const { client, pages, channelId, messageId } = state;

  // Always remove the user's reaction immediately so they can use it again
  await removeUserReaction(client, channelId, messageId, emoji, userId);

  let newPage = state.page;

  switch (emoji) {
    case EMOJIS.FIRST:
      newPage = 0;
      break;
    case EMOJIS.BACK:
      newPage = state.page > 0 ? state.page - 1 : pages.length - 1;
      break;
    case EMOJIS.FORWARD:
      newPage = state.page < pages.length - 1 ? state.page + 1 : 0;
      break;
    case EMOJIS.LAST:
      newPage = pages.length - 1;
      break;
    case EMOJIS.DELETE:
      await state.destroy(true);
      return;
    default:
      return;
  }

  if (newPage === state.page) return; // already on this page, nothing to do

  state.page = newPage;

  // Edit the message to show the new page
  try {
    await client.rest.patch(`/channels/${channelId}/messages/${messageId}`, pages[newPage]);
  } catch (e) {
    logger.warn(`Paginator failed to edit message to page ${newPage}: ${e}`);
    return;
  }

  // Reset the inactivity timeout
  clearTimeout(state.timeout);
  state.timeout = setTimeout(() => state.destroy(false), 120_000);
}

export { EMOJIS as PAGINATION_EMOJIS };