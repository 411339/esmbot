import { safeBigInt } from "./misc.ts";
import type { FluxerChannel, FluxerGuild, FluxerMember, FluxerRole, FluxerUser } from "./types.ts";
import type { FluxerClient } from "./fluxerClient.ts";

const mentionRegex = /^<?[@#]?[&!]?(\d+)>?$/;

interface MentionToObjectParams {
  guild?: FluxerGuild | null;
  server?: boolean;
  rest?: boolean;
}

type MentionTypes = "user" | "role" | "channel";

export async function mentionToObject(
  client: FluxerClient,
  mention: string,
  type: "user",
  options: MentionToObjectParams,
): Promise<FluxerUser | FluxerMember>;
export async function mentionToObject(
  client: FluxerClient,
  mention: string,
  type: "role",
  options: MentionToObjectParams,
): Promise<FluxerRole>;
export async function mentionToObject(
  client: FluxerClient,
  mention: string,
  type: "channel",
  options: MentionToObjectParams,
): Promise<FluxerChannel>;
export async function mentionToObject(
  client: FluxerClient,
  mention: string,
  type: MentionTypes,
  options: MentionToObjectParams,
) {
  let obj;
  if (validID(mention)) {
    if (type === "user") {
      obj = await getUser(client, options.guild, mention, options.server, options.rest);
    } else if (type === "role") {
      obj = await getRole(client, options.guild!, mention);
    } else if (type === "channel") {
      obj = await getChannel(client, mention);
    }
  } else if (mentionRegex.test(mention)) {
    const id = mention.match(mentionRegex)?.[1];
    if (id && validID(id)) {
      if (type === "user") {
        obj = await getUser(client, options.guild, id, options.server, options.rest);
      } else if (type === "role") {
        obj = await getRole(client, options.guild!, id);
      } else if (type === "channel") {
        obj = await getChannel(client, id);
      }
    }
  }
  return obj;
}

function validID(id: string) {
  return safeBigInt(id) > 21154535154122752n;
}

async function getChannel(client: FluxerClient, id: string) {
  let channel = client.getChannel(id);
  if (!channel) channel = (await client.rest.get(`/channels/${id}`)) as FluxerChannel;
  return channel;
}

async function getRole(client: FluxerClient, guild: FluxerGuild, id: string) {
  let role = guild?.roles.find((r) => r.id === id);
  if (!role && guild) role = (await client.rest.get(`/guilds/${guild.id}/roles/${id}`)) as FluxerRole;
  return role;
}

export async function getUser(
  client: FluxerClient,
  guild: FluxerGuild | null | undefined,
  id: string,
  member = false,
  rest = false,
): Promise<FluxerMember | FluxerUser> {
  let user;
  if (member && guild) {
    if (!rest) user = guild.members?.find((m) => m.user?.id === id);
    if (!user) user = (await client.rest.getGuildMember(guild.id, id)) as FluxerMember & { user: FluxerUser };
  } else {
    if (!rest) user = client.users.get(id);
    if (!user) user = (await client.rest.getUser(id)) as FluxerUser;
  }
  return user;
}
