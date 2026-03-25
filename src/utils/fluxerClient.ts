/**
 * fluxerClient.ts
 *
 * A thin wrapper around @discordjs/rest and @discordjs/ws that targets the
 * Fluxer API (https://api.fluxer.app, gateway version 1).
 *
 * The shape of responses is essentially Discord pre-v9, which Fluxer mirrors.
 * We expose a simplified FluxerClient interface that the rest of esmBot uses,
 * so that nothing outside this file needs to know about @discordjs/* internals.
 */

import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { REST } from "@discordjs/rest";
import { WebSocketManager, WebSocketShardEvents } from "@discordjs/ws";
import { GatewayDispatchEvents, GatewayOpcodes } from "@discordjs/core";
import logger from "./logger.ts";
import type {
  CreateMessageData,
  FluxerAttachment,
  FluxerChannel,
  FluxerClient,
  FluxerEmbed,
  FluxerGuild,
  FluxerMember,
  FluxerMessage,
  FluxerRESTClient,
  FluxerRole,
  FluxerUser,
} from "./types.ts";

export { GatewayDispatchEvents };

const FLUXER_API = "https://api.fluxer.app";
// Note: Fluxer API routes are at /v1, handled in each request path

// ─── REST client ─────────────────────────────────────────────────────────────

class FluxerREST implements FluxerRESTClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${FLUXER_API}/v1${path}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);
    if (!res.ok) {
      const error = (await res.json().catch(() => ({ message: res.statusText }))) as { message: string };
      throw new Error(`HTTP ${res.status} on ${method} ${path}: ${error.message}`);
    }

    if (res.status === 204) return undefined; // No content
    return res.json();
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }

  async get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  async patch(path: string, body?: unknown): Promise<unknown> {
    return this.request("PATCH", path, body);
  }

  async delete(path: string): Promise<void> {
    await this.request("DELETE", path);
  }

  async postWithFiles(path: string, body: unknown, files: { name: string; data: Buffer }[]): Promise<unknown> {
    const formData = new FormData();
    formData.set("payload_json", JSON.stringify(body));
    for (const [i, file] of files.entries()) {
      formData.set(`files[${i}]`, new Blob([file.data]), file.name);
    }
    // Use raw fetch so we can send multipart
    const res = await fetch(`${FLUXER_API}/v1${path}`, {
      method: "POST",
      headers: { Authorization: `Bot ${this.token}` },
      body: formData,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on POST ${path}`);
    return res.json();
  }

  async sendTyping(channelId: string): Promise<void> {
    await this.post(`/channels/${channelId}/typing`);
  }

  async createMessage(channelId: string, data: CreateMessageData): Promise<FluxerMessage> {
    if (data.files && data.files.length > 0) {
      return this.postWithFiles(
        `/channels/${channelId}/messages`,
        {
          content: data.content,
          embeds: data.embeds,
          message_reference: data.message_reference,
          allowed_mentions: data.allowed_mentions,
          components: data.components,
          flags: data.flags,
        },
        data.files,
      ) as Promise<FluxerMessage>;
    }
    return this.post(`/channels/${channelId}/messages`, data) as Promise<FluxerMessage>;
  }

  async editMessage(channelId: string, messageId: string, data: Partial<CreateMessageData>): Promise<FluxerMessage> {
    return this.patch(`/channels/${channelId}/messages/${messageId}`, data) as Promise<FluxerMessage>;
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.delete(`/channels/${channelId}/messages/${messageId}`);
  }

  async getMessages(channelId: string, limit = 50): Promise<FluxerMessage[]> {
    return this.get(`/channels/${channelId}/messages?limit=${limit}`) as Promise<FluxerMessage[]>;
  }

  async getMessage(channelId: string, messageId: string): Promise<FluxerMessage> {
    return this.get(`/channels/${channelId}/messages/${messageId}`) as Promise<FluxerMessage>;
  }

  async getUser(userId: string): Promise<FluxerUser> {
    return this.get(`/users/${userId}`) as Promise<FluxerUser>;
  }

  async getGuildMember(guildId: string, userId: string): Promise<FluxerMember & { user: FluxerUser }> {
    return this.get(`/guilds/${guildId}/members/${userId}`) as Promise<FluxerMember & { user: FluxerUser }>;
  }

  async getChannel(channelId: string): Promise<FluxerChannel> {
    return this.get(`/channels/${channelId}`) as Promise<FluxerChannel>;
  }

  async searchGuildMembers(
    guildId: string,
    query: string,
    limit = 1,
  ): Promise<(FluxerMember & { user: FluxerUser })[]> {
    return this.get(
      `/guilds/${guildId}/members/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    ) as Promise<(FluxerMember & { user: FluxerUser })[]>;
  }
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class FluxerClientImpl extends EventEmitter implements FluxerClient {
  user!: FluxerUser;
  rest: FluxerRESTClient;
  guilds = new Map<string, FluxerGuild>();
  channels = new Map<string, FluxerChannel>();
  users = new Map<string, FluxerUser>();
  ready = false;
  guildShardMap = new Map<string, number>();
  shards = new Map<number, { id: number; latency: number; status: string }>();

  private _startTime = Date.now();
  private gateway: WebSocketManager;
  private _token: string;

  constructor(token: string, intents?: number) {
    super();
    this._token = token;
    this.rest = new FluxerREST(token);

    const defaultIntents =
      (1 << 0) | // GUILDS
      (1 << 9) | // GUILD_MESSAGES
      (1 << 10) | // GUILD_MESSAGE_REACTIONS
      (1 << 12) | // DIRECT_MESSAGES
      (1 << 13) | // DIRECT_MESSAGE_REACTIONS
      (1 << 15); // MESSAGE_CONTENT

    this.gateway = new WebSocketManager({
      token,
      intents: intents ?? defaultIntents,
      rest: new REST({ api: FLUXER_API, version: "1" }).setToken(token),
    });

    this._bindGatewayEvents();
  }

  get uptime(): number {
    return Date.now() - this._startTime;
  }

  // biome-ignore lint/suspicious/noExplicitAny: gateway emits raw payloads
  private _bindGatewayEvents() {
    this.gateway.on(WebSocketShardEvents.Dispatch, ({ data }: any) => {
      if (!data) return;
      const { t: eventName, d: eventData } = data as { t: string; d: unknown };
      if (!eventName) return;

      switch (eventName) {
        case GatewayDispatchEvents.Ready: {
          const ready = eventData as {
            user: FluxerUser;
            guilds: { id: string; unavailable?: boolean }[];
            session_id: string;
          };
          this.user = ready.user;
          this.ready = true;
          this._startTime = Date.now();
          this.emit("ready", ready);
          break;
        }

        case GatewayDispatchEvents.GuildCreate: {
          const guild = eventData as FluxerGuild & {
            channels: FluxerChannel[];
            members: (FluxerMember & { user: FluxerUser })[];
          };
          this.guilds.set(guild.id, guild);
          if (guild.channels) {
            for (const ch of guild.channels) this.channels.set(ch.id, ch);
          }
          if (guild.members) {
            for (const m of guild.members) {
              if (m.user) this.users.set(m.user.id, m.user);
            }
          }
          this.emit("guildCreate", guild);
          break;
        }

        case GatewayDispatchEvents.GuildUpdate: {
          const guild = eventData as FluxerGuild;
          const existing = this.guilds.get(guild.id);
          if (existing) this.guilds.set(guild.id, { ...existing, ...guild });
          this.emit("guildUpdate", guild);
          break;
        }

        case GatewayDispatchEvents.GuildDelete: {
          const partial = eventData as { id: string; unavailable?: boolean };
          this.guilds.delete(partial.id);
          this.emit("guildDelete", partial);
          break;
        }

        case GatewayDispatchEvents.ChannelCreate: {
          const ch = eventData as FluxerChannel;
          this.channels.set(ch.id, ch);
          this.emit("channelCreate", ch);
          break;
        }

        case GatewayDispatchEvents.ChannelUpdate: {
          const ch = eventData as FluxerChannel;
          this.channels.set(ch.id, ch);
          this.emit("channelUpdate", ch);
          break;
        }

        case GatewayDispatchEvents.ChannelDelete: {
          const ch = eventData as FluxerChannel;
          this.channels.delete(ch.id);
          this.emit("channelDelete", ch);
          break;
        }

        case GatewayDispatchEvents.MessageCreate: {
          const msg = eventData as FluxerMessage;
          if (msg.author?.id && !this.users.has(msg.author.id)) {
            this.users.set(msg.author.id, msg.author);
          }
          this.emit("messageCreate", msg);
          break;
        }

        case GatewayDispatchEvents.MessageUpdate:
          this.emit("messageUpdate", eventData);
          break;

        case GatewayDispatchEvents.MessageDelete:
          this.emit("messageDelete", eventData);
          break;

        case GatewayDispatchEvents.GuildMemberAdd: {
          const member = eventData as FluxerMember & { user: FluxerUser; guild_id: string };
          if (member.user) this.users.set(member.user.id, member.user);
          this.emit("guildMemberAdd", member);
          break;
        }

        case GatewayDispatchEvents.GuildMemberRemove:
          this.emit("guildMemberRemove", eventData);
          break;

        case GatewayDispatchEvents.MessageReactionAdd:
          this.emit("messageReactionAdd", eventData);
          break;

        case GatewayDispatchEvents.MessageReactionRemove:
          this.emit("messageReactionRemove", eventData);
          break;

        default:
          // Emit raw event for anything else (error, warn, debug, etc.)
          this.emit(eventName.toLowerCase(), eventData);
          break;
      }
    });

    this.gateway.on(WebSocketShardEvents.Error, ({ error }: any) => {
      this.emit("error", error);
    });

    // @ts-expect-error: @discordjs/ws type definitions don't expose shardId here but it exists at runtime
    this.gateway.on(WebSocketShardEvents.Hello, ({ shardId }) => {
      logger.debug(`Gateway hello on shard ${shardId}`);
    });
  }

  async connect() {
    await this.gateway.connect();
  }

  disconnect(_reconnect: boolean) {
    void this.gateway.destroy();
  }

  getChannel<T extends FluxerChannel = FluxerChannel>(id: string): T | undefined {
    return this.channels.get(id) as T | undefined;
  }

  async editStatus(status: string, activities: { type: number; name: string }[]) {
    await this.gateway.send(0, {
      op: GatewayOpcodes.PresenceUpdate,
      d: {
        status: status as any,
        since: null,
        activities: activities.map((a) => ({ type: a.type, name: a.name })),
        afk: false,
      },
    });
  }

  /** Permissions helper: compute member permissions in a guild */
  computeMemberPermissions(guild: FluxerGuild, member: FluxerMember): bigint {
    if (guild.owner_id === member.user?.id) return BigInt("0xFFFFFFFFFFFFFFFF");
    const everyoneRole = guild.roles.find((r) => r.id === guild.id);
    let perms = everyoneRole ? BigInt(everyoneRole.permissions) : 0n;
    for (const roleId of member.roles) {
      const role = guild.roles.find((r) => r.id === roleId);
      if (role) perms |= BigInt(role.permissions);
    }
    // ADMINISTRATOR
    if ((perms & 0x8n) !== 0n) return BigInt("0xFFFFFFFFFFFFFFFF");
    return perms;
  }

  /** Check if computed perms include a named permission */
  hasPermission(perms: bigint, flag: keyof typeof PERMISSION_FLAGS): boolean {
    return (perms & PERMISSION_FLAGS[flag]) !== 0n;
  }
}

export const PERMISSION_FLAGS = {
  ADMINISTRATOR: 0x8n,
  MANAGE_GUILD: 0x20n,
  MANAGE_CHANNELS: 0x10n,
  MANAGE_MESSAGES: 0x2000n,
  SEND_MESSAGES: 0x800n,
  READ_MESSAGE_HISTORY: 0x10000n,
  EMBED_LINKS: 0x4000n,
  ATTACH_FILES: 0x8000n,
  USE_EXTERNAL_EMOJIS: 0x40000n,
  ADD_REACTIONS: 0x40n,
} as const;

export type PermissionFlag = keyof typeof PERMISSION_FLAGS;

// Type alias for convenience - FluxerClient refers to the implementation
export type { FluxerClient } from "./types.ts";