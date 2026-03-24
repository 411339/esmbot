import process from "node:process";
import { getString } from "#utils/i18n.js";
import { cleanMessage } from "#utils/misc.js";
import type {
  CreateMessageData,
  ExtendedConstructedCommandOptions,
  FluxerAttachment,
  FluxerClient,
  FluxerGuild,
  FluxerMember,
  FluxerMessage,
  FluxerUser,
  Param,
} from "#utils/types.js";
import { PERMISSION_FLAGS, type PermissionFlag } from "#utils/fluxerClient.js";
import type { DatabasePlugin } from "../database.ts";

export type CommandOptions = {
  type: "classic";
  cmdName: string;
  args: string[];
  message: FluxerMessage;
  content: string;
  specialArgs: {
    [key: string]: string | boolean | number;
  };
};

class Command {
  client: FluxerClient;
  origOptions: CommandOptions;
  type: "classic";
  success: boolean;
  args: string[];
  cmdName: string;
  author: FluxerUser;
  /** Raw bigint permissions value for the bot in this channel/guild */
  permissions: bigint;
  /** Raw bigint permissions value for the invoking member */
  memberPermissions: bigint;

  database?: DatabasePlugin;
  message: FluxerMessage;
  channel: { id: string; guild_id?: string };
  guild: FluxerGuild | null;
  member?: FluxerMember | null;
  content?: string;
  reference: NonNullable<CreateMessageData["message_reference"]> & { fail_if_not_exists: boolean };
  private options?: { [key: string]: string | number | boolean } | null;

  constructor(client: FluxerClient, database: DatabasePlugin | undefined, options: CommandOptions) {
    this.client = client;
    this.database = database;
    this.origOptions = options;
    this.type = "classic";
    this.success = true;

    this.message = options.message;
    this.args = options.args;
    this.cmdName = options.cmdName;
    this.channel = { id: options.message.channel_id, guild_id: options.message.guild_id };
    this.guild = options.message.guild_id ? (client.guilds.get(options.message.guild_id) ?? null) : null;
    this.author = options.message.author;
    this.member = options.message.member ?? null;
    this.content = options.content;
    this.options = options.specialArgs;
    this.reference = {
      message_id: options.message.id,
      channel_id: options.message.channel_id,
      guild_id: options.message.guild_id,
      fail_if_not_exists: false,
    };

    // Compute permissions
    if (this.guild && this.member && client instanceof Object && "computeMemberPermissions" in client) {
      // biome-ignore lint/suspicious/noExplicitAny: FluxerClientImpl method
      const impl = client as any;
      this.permissions = impl.computeMemberPermissions(this.guild, {
        ...this.member,
        user: { id: client.user.id, username: client.user.username, discriminator: client.user.discriminator, avatar: client.user.avatar },
        roles: this.member.roles ?? [],
      });
      this.memberPermissions = impl.computeMemberPermissions(this.guild, {
        ...this.member,
        user: this.author,
        roles: this.member.roles ?? [],
      });
    } else {
      // DMs: grant everything
      this.permissions = BigInt("0xFFFFFFFFFFFFFFFF");
      this.memberPermissions = BigInt("0xFFFFFFFFFFFFFFFF");
    }
  }

  /** Check if the bot has a given permission */
  hasPermission(flag: PermissionFlag): boolean {
    return (this.permissions & PERMISSION_FLAGS[flag]) !== 0n;
  }

  /** Check if the invoking member has a given permission */
  memberHasPermission(flag: PermissionFlag): boolean {
    return (this.memberPermissions & PERMISSION_FLAGS[flag]) !== 0n;
  }

  async run(): Promise<string | CreateMessageData | undefined> {
    this.success = false;
    return this.getString(`commands.responses.${this.cmdName}.invalid`);
  }

  async acknowledge() {
    await this.client.rest.sendTyping(this.message.channel_id);
  }

  getString(key: string, params?: { returnNull?: false; params?: { [key: string]: string } }): string;
  getString(key: string, params: { returnNull: boolean; params?: { [key: string]: string } }): string | undefined;
  getString(key: string, params?: { returnNull?: boolean; params?: { [key: string]: string } }): string | undefined {
    return getString(key, {
      locale: process.env.LOCALE ?? "en-US",
      returnNull: params?.returnNull ?? false,
      ...params,
    });
  }

  getOptionString(key: string, defaultArg?: boolean): string | undefined {
    return defaultArg ? this.args.join(" ").trim() : (this.options?.[key] as string | undefined);
  }

  getOptionBoolean(key: string, defaultArg?: boolean): boolean | undefined {
    const option = defaultArg ? this.args.join(" ").trim() : this.options?.[key];
    if (option !== undefined && option !== null && option !== "") return !!option;
    return undefined;
  }

  getOptionNumber(key: string, defaultArg?: boolean): number | undefined {
    const raw = defaultArg ? this.args.join(" ").trim() : (this.options?.[key] as string | undefined);
    if (raw === undefined) return undefined;
    return Number.parseFloat(String(raw));
  }

  getOptionInteger(key: string, defaultArg?: boolean): number | undefined {
    const raw = defaultArg ? this.args.join(" ").trim() : (this.options?.[key] as string | undefined);
    if (raw === undefined) return undefined;
    return Number.parseInt(String(raw));
  }

  getOptionUser(_key: string, defaultArg?: boolean): FluxerUser | undefined {
    const id = defaultArg ? this.args.join(" ").trim() : (this.options?.[_key] as string | undefined);
    if (!id) return undefined;
    return this.client.users.get(id);
  }

  getOptionMember(_key: string, defaultArg?: boolean): (FluxerMember & { user: FluxerUser }) | undefined {
    const id = defaultArg ? this.args.join(" ").trim() : (this.options?.[_key] as string | undefined);
    if (!id || !this.guild) return undefined;
    const m = this.guild.members?.find((m) => m.user?.id === id);
    return m as (FluxerMember & { user: FluxerUser }) | undefined;
  }

  getOptionRole(_key: string): { id: string; name: string; permissions: string } | undefined {
    const id = this.options?.[_key] as string | undefined;
    if (!id || !this.guild) return undefined;
    return this.guild.roles.find((r) => r.id === id);
  }

  getOptionAttachment(_key: string): FluxerAttachment | undefined {
    return this.message.attachments?.[0];
  }

  clean(text: string) {
    return cleanMessage(this.message, text);
  }

  static init() {
    return this;
  }

  static description = "No description found";
  static aliases: string[] = [];
  static flags: ExtendedConstructedCommandOptions[] = [];
  static dbRequired = false;
  static slashAllowed = false; // always false on Fluxer (no slash commands)
  static directAllowed = true;
  static userAllowed = true;
  static adminOnly = false;
}

export default Command;