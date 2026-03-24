import process from "node:process";
import logger from "./logger.ts";
import { formats, getType } from "./media.ts";
import type {
  FluxerAttachment,
  FluxerClient,
  FluxerEmbed,
  FluxerMessage,
  MediaParams,
  MediaTypeData,
} from "./types.ts";

const tenorURLs = ["tenor.com", "www.tenor.com"];
const giphyURLs = ["giphy.com", "www.giphy.com", "i.giphy.com"];
const giphyMediaURLs = [
  "media.giphy.com",
  "media0.giphy.com",
  "media1.giphy.com",
  "media2.giphy.com",
  "media3.giphy.com",
  "media4.giphy.com",
];
const klipyURLs = ["klipy.com"];
const combined = [...tenorURLs, ...giphyURLs, ...giphyMediaURLs, ...klipyURLs];
const providerUrls = ["https://tenor.co", "https://tenor.com", "https://giphy.com", "https://klipy.com"];

type TenorMediaObject = { url: string; dims: number[]; duration: number; size: number };
type TenorResponse = {
  error?: { code: number; message: string; status: string };
  results: { media_formats: { [key: string]: TenorMediaObject } }[];
};

type KlipyMediaObject = { url: string; width: number; height: number; size: number };
type KlipyMediaTypes = { gif: KlipyMediaObject; webp: KlipyMediaObject; jpg: KlipyMediaObject; mp4: KlipyMediaObject; webm: KlipyMediaObject };
type KlipyMediaResult = { id: number; slug: string; title: string; file: { hd: KlipyMediaTypes; md: KlipyMediaTypes; sm: KlipyMediaTypes; xs: KlipyMediaTypes }; tags: string[]; type: string; blur_preview: string };
type KlipyResponse = { result: boolean; errors?: { message: string[] }; data: { data: KlipyMediaResult[] } };

export type MediaMeta = {
  path: string;
  type?: string;
  url: string;
  name: string;
  spoiler: boolean;
  mediaType?: MediaParams["type"];
};

async function getMedia(
  media: string,
  media2: string,
  mediaType: MediaParams["type"][],
  single = false,
  spoiler = false,
  extraReturnTypes = false,
  type: string | null = null,
): Promise<MediaMeta | undefined> {
  let mediaURL: URL;
  try {
    mediaURL = new URL(media);
    if (!mediaURL.host) throw null;
    if (mediaURL.protocol !== "http:" && mediaURL.protocol !== "https:") throw null;
  } catch {
    return { url: media2, path: media, name: "null", type: "badurl", spoiler };
  }
  const fileNameSplit = mediaURL.pathname.split("/");
  const fileName = fileNameSplit[fileNameSplit.length - 1];
  const fileNameNoExtension = fileName.slice(0, fileName.lastIndexOf("."));
  const payload: MediaMeta = { url: media2, path: media, name: fileNameNoExtension, spoiler };
  const url2 = new URL(media2);
  const host = url2.host;

  if (mediaType.includes("image") && combined.includes(host)) {
    if (tenorURLs.includes(host)) {
      if (process.env.TENOR && process.env.TENOR !== "") {
        let id: string | undefined;
        if (url2.pathname.startsWith("/view/")) {
          id = media2.split("-").pop();
        } else if (url2.pathname.endsWith(".gif")) {
          const redirect = (await fetch(media2, { method: "HEAD", redirect: "manual" })).headers.get("location");
          id = redirect?.split("-").pop();
        } else {
          return;
        }
        if (Number.isNaN(Number(id))) return;
        const data = await fetch(
          `https://tenor.googleapis.com/v2/posts?media_filter=gif&limit=1&client_key=esmBot%20${process.env.ESMBOT_VER}&key=${process.env.TENOR}&ids=${id}`,
        );
        if (data.status === 429) {
          if (extraReturnTypes) { payload.type = "tenorlimit"; return payload; }
        }
        const json = (await data.json()) as TenorResponse;
        if (json.error) throw Error(json.error.message);
        if (json.results.length === 0) return;
        payload.path = json.results[0].media_formats.gif.url;
      } else if (url2.pathname.startsWith("/view/")) {
        const tenorURL = url2;
        if (!tenorURL.pathname.endsWith(".gif")) tenorURL.pathname += ".gif";
        const redirectReq = await fetch(tenorURL, { method: "HEAD", redirect: "manual" });
        if (redirectReq.status !== 301 && redirectReq.status !== 302) return;
        const redirect = redirectReq.headers.get("location");
        if (!redirect) return;
        payload.path = redirect;
      } else {
        return;
      }
      payload.type = "image/gif";
      payload.mediaType = "image";
    } else if (klipyURLs.includes(host)) {
      if (!process.env.KLIPY || process.env.KLIPY === "") return;
      if (!media2.includes("klipy.com/gifs/")) return;
      const id = url2.pathname.replace("/gifs/", "");
      const data = await fetch(`https://api.klipy.com/api/v1/${process.env.KLIPY}/gifs/items?slugs=${id}`);
      if (data.status === 429) {
        if (extraReturnTypes) { payload.type = "klipylimit"; return payload; }
      }
      const json = (await data.json()) as KlipyResponse;
      if (json.errors) throw AggregateError(json.errors.message);
      if (json.data.data.length === 0) return;
      payload.path = json.data.data[0].file.hd.gif.url;
      payload.type = "image/gif";
      payload.mediaType = "image";
    } else if (giphyURLs.includes(host)) {
      payload.path = `https://media0.giphy.com/media/${media2.split("/")[4].split("-").pop()}/giphy.webp`;
      payload.type = "image/webp";
      payload.mediaType = "image";
    } else if (giphyMediaURLs.includes(host)) {
      payload.path = `https://media0.giphy.com/media/${media2.split("/")[4]}/giphy.webp`;
      payload.type = "image/webp";
      payload.mediaType = "image";
    }
  } else {
    const result = await getType(mediaURL, extraReturnTypes, mediaType);
    if (!result) return;
    if (result.url) payload.path = result.url;
    payload.type = type ?? result.type;
    if (result.mediaType) payload.mediaType = result.mediaType;
    if (payload.type === "large" && single) return payload;
    if (
      !payload.type ||
      !payload.mediaType ||
      ![...(mediaType.length === 0 ? formats.image : mediaType.flatMap((v) => formats[v]))].includes(payload.type)
    )
      return;
  }
  return payload;
}

async function checkMedia(
  message: FluxerMessage,
  extraReturnTypes: boolean,
  mediaType: MediaParams["type"][],
  singleMessage = false,
): Promise<MediaMeta | undefined> {
  let type: MediaMeta | undefined;

  // Check embeds
  if (message.embeds?.length !== 0) {
    type = await checkEmbeds(message.embeds ?? [], message.content ?? "", extraReturnTypes, mediaType, singleMessage);
  }

  // Check attachments
  if (!type && message.attachments?.length !== 0) {
    const first = message.attachments?.[0];
    if (first) {
      const isSpoiler = first.filename.startsWith("SPOILER_");
      type = await getMedia(first.proxy_url, first.url, mediaType, singleMessage, isSpoiler);
    }
  }

  return type;
}

function checkEmbeds(
  embeds: FluxerEmbed[],
  content: string,
  extraReturnTypes: boolean,
  mediaType: MediaParams["type"][],
  singleMessage = false,
): Promise<MediaMeta | undefined> | undefined {
  if (!embeds[0]) return;
  let hasSpoiler = false;
  if (embeds[0].url && content) {
    hasSpoiler = /\|\|.*https?:\/\/.*\|\|/s.test(content);
  }
  if (
    embeds[0].provider?.url &&
    providerUrls.includes(embeds[0].provider.url) &&
    embeds[0].video?.url &&
    embeds[0].url
  ) {
    return getMedia(embeds[0].video.url, embeds[0].url, mediaType, singleMessage, hasSpoiler, extraReturnTypes);
  } else if (embeds[0].thumbnail) {
    return getMedia(
      embeds[0].thumbnail.proxy_url ?? embeds[0].thumbnail.url,
      embeds[0].thumbnail.url,
      mediaType,
      singleMessage,
      hasSpoiler,
      extraReturnTypes,
    );
  } else if (embeds[0].image) {
    return getMedia(
      embeds[0].image.proxy_url ?? embeds[0].image.url,
      embeds[0].image.url,
      mediaType,
      singleMessage,
      hasSpoiler,
      extraReturnTypes,
    );
  }
}

export async function stickerDetect(
  client: FluxerClient,
  cmdMessage?: FluxerMessage,
): Promise<{ id: string; name: string; format_type: number } | undefined> {
  if (cmdMessage) {
    // Check reply
    if (cmdMessage.message_reference?.message_id && cmdMessage.message_reference.channel_id) {
      const replyMessage = await client.rest
        .getMessage(cmdMessage.message_reference.channel_id, cmdMessage.message_reference.message_id)
        .catch(() => undefined);
      if (replyMessage?.sticker_items) return replyMessage.sticker_items[0];
    }
    if (cmdMessage.sticker_items) return cmdMessage.sticker_items[0];

    // Scan recent messages
    const messages = await client.rest.getMessages(cmdMessage.channel_id).catch(() => [] as FluxerMessage[]);
    for (const message of messages) {
      if (message.sticker_items) return message.sticker_items[0];
    }
  }
}

/**
 * Main media detection function.
 * Checks the invoking message (and its reply) for images/GIFs,
 * then falls back to scanning recent channel history.
 */
export default async (
  client: FluxerClient,
  perms: bigint,
  mediaType: MediaParams["type"][],
  cmdMessage?: FluxerMessage,
  _interaction?: undefined,
  extraReturnTypes = false,
  singleMessage = false,
): Promise<MediaMeta | undefined> => {
  if (cmdMessage) {
    // Check attachment/link options first (passed via specialArgs by the command)
    const linkArg = undefined; // links are handled by callers via getOptionString("link")

    // Check reply
    if (cmdMessage.message_reference?.message_id && cmdMessage.message_reference.channel_id && !singleMessage) {
      const replyMessage = await client.rest
        .getMessage(cmdMessage.message_reference.channel_id, cmdMessage.message_reference.message_id)
        .catch(() => undefined);
      if (replyMessage) {
        const replyResult = await checkMedia(replyMessage, extraReturnTypes, mediaType);
        if (replyResult) return replyResult;
      }
    }

    // Check current message
    const result = await checkMedia(cmdMessage, extraReturnTypes, mediaType, singleMessage);
    if (result) return result;
  }

  // Scan recent channel history
  if (!singleMessage && cmdMessage) {
    const READ_HISTORY_PERM = 0x10000n;
    if (perms && (perms & READ_HISTORY_PERM) === 0n) return;
    const messages = await client.rest
      .getMessages(cmdMessage.channel_id)
      .catch(() => [] as FluxerMessage[]);
    for (const message of messages) {
      const result = await checkMedia(message, extraReturnTypes, mediaType);
      if (result) return result;
    }
  }
};