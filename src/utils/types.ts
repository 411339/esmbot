import type Command from "#cmd-classes/command.js";
import type { DatabasePlugin } from "../database.ts";

export interface DBGuild {
  guild_id: string;
  prefix: string;
  disabled: string[];
  disabled_commands: string[];
  tag_roles: string[];
}

export interface Tag {
  name: string;
  content: string;
  author: string;
}

export interface Count {
  command: string;
  count: number;
}

export interface CommandsConfig {
  types: {
    classic: boolean;
  };
  blacklist: string[];
}

// Minimal Fluxer/Discord-compatible user shape (pre-v9 Discord API style)
export interface FluxerUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  bot?: boolean;
  global_name?: string | null;
}

export interface FluxerMember {
  user?: FluxerUser;
  nick?: string | null;
  roles: string[];
  joined_at: string;
  deaf: boolean;
  mute: boolean;
  permissions?: string;
}

export interface FluxerAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url: string;
  content_type?: string;
  flags?: number;
}

export interface FluxerEmbed {
  title?: string;
  description?: string;
  url?: string;
  image?: { url: string; proxy_url?: string };
  thumbnail?: { url: string; proxy_url?: string };
  video?: { url: string };
  provider?: { url?: string; name?: string };
}

export interface FluxerMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: FluxerUser;
  member?: FluxerMember;
  content: string;
  timestamp: string;
  attachments: FluxerAttachment[];
  embeds: FluxerEmbed[];
  mentions: FluxerUser[];
  mention_roles: string[];
  mention_channels?: { id: string; name: string }[];
  message_reference?: {
    message_id?: string;
    channel_id?: string;
    guild_id?: string;
  };
  sticker_items?: { id: string; name: string; format_type: number }[];
  components?: unknown[];
}

export interface FluxerChannel {
  id: string;
  type: number;
  guild_id?: string;
  name?: string;
  topic?: string | null;
  nsfw?: boolean;
  parent_id?: string | null;
  permission_overwrites?: unknown[];
}

export interface FluxerGuild {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string;
  roles: FluxerRole[];
  channels?: FluxerChannel[];
  members?: FluxerMember[];
  member_count?: number;
  premium_tier?: number;
}

export interface FluxerRole {
  id: string;
  name: string;
  permissions: string;
  position: number;
  hoist: boolean;
}

export interface FluxerReadyData {
  v: number;
  user: FluxerUser;
  guilds: { id: string; unavailable?: boolean }[];
  session_id: string;
}

export type CommandType = "classic";

export type CommandFlagType =
  | "string"
  | "integer"
  | "boolean"
  | "user"
  | "channel"
  | "role"
  | "mentionable"
  | "number"
  | "attachment";

export type ExtCommand = {
  baseCommand: boolean;
  category: string;
  params: Param[];
} & typeof Command;

export type ExtendedConstructedCommandOptions = {
  name: string;
  type: CommandFlagType | number;
  description: string;
  classic?: boolean;
  required?: boolean;
  default?: unknown;
  choices?: { name: string; value: string }[];
  minValue?: number;
  maxValue?: number;
  maxLength?: number;
  nameLocalizations?: Record<string, string>;
  descriptionLocalizations?: Record<string, string>;
  options?: ExtendedConstructedCommandOptions[];
};

export type Param =
  | {
      name: string;
      desc: string;
      params: Param[];
    }
  | string;

export interface MediaParams {
  cmd: string;
  type: "image";
  params: {
    [key: string]: string | number | boolean;
  };
  input?: {
    data?: ArrayBuffer;
    type?: string;
  };
  id: string;
  path?: string;
  url?: string;
  name?: string;
  onlyAnim?: boolean;
  spoiler?: boolean;
  token?: string;
}

export interface MediaTypeData {
  url?: string;
  type?: string;
  mediaType?: MediaParams["type"];
}

export interface MediaFormats {
  image?: {
    [cmd: string]: string[];
  };
}

export interface MediaFuncs {
  image?: string[];
}

export interface SearXNGResults {
  query: string;
  results: {
    author?: string;
    img_src?: string;
    title: string;
    url: string;
  }[];
}

export interface EventParams {
  client: FluxerClient;
  database: DatabasePlugin | undefined;
}

// Minimal REST client interface we use internally
export interface FluxerRESTClient {
  post(path: string, body?: unknown): Promise<unknown>;
  get(path: string): Promise<unknown>;
  patch(path: string, body?: unknown): Promise<unknown>;
  delete(path: string): Promise<void>;
  postWithFiles(path: string, body: unknown, files: { name: string; data: Buffer }[]): Promise<unknown>;
  sendTyping(channelId: string): Promise<void>;
  createMessage(channelId: string, data: CreateMessageData): Promise<FluxerMessage>;
  editMessage(channelId: string, messageId: string, data: Partial<CreateMessageData>): Promise<FluxerMessage>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  getMessages(channelId: string, limit?: number): Promise<FluxerMessage[]>;
  getMessage(channelId: string, messageId: string): Promise<FluxerMessage>;
  getUser(userId: string): Promise<FluxerUser>;
  getGuildMember(guildId: string, userId: string): Promise<FluxerMember & { user: FluxerUser }>;
  getChannel(channelId: string): Promise<FluxerChannel>;
  searchGuildMembers(guildId: string, query: string, limit?: number): Promise<(FluxerMember & { user: FluxerUser })[]>;
}

export interface CreateMessageData {
  content?: string;
  embeds?: FluxerEmbed[];
  files?: { name: string; data: Buffer }[];
  message_reference?: { message_id: string; channel_id?: string; guild_id?: string; fail_if_not_exists?: boolean };
  allowed_mentions?: {
    parse?: string[];
    users?: string[];
    roles?: string[];
    replied_user?: boolean;
  };
  components?: unknown[];
  flags?: number;
}

// The top-level client object we pass around
export interface FluxerClient {
  user: FluxerUser;
  rest: FluxerRESTClient;
  guilds: Map<string, FluxerGuild>;
  channels: Map<string, FluxerChannel>;
  users: Map<string, FluxerUser>;
  ready: boolean;
  // guild shard mapping (guild_id -> shard_id)
  guildShardMap: Map<string, number>;
  shards: Map<number, { id: number; latency: number; status: string }>;
  uptime: number;
  editStatus(status: string, activities: { type: number; name: string }[]): Promise<void>;
  getChannel<T extends FluxerChannel = FluxerChannel>(id: string): T | undefined;
  disconnect(reconnect: boolean): void;
}

export function isError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}