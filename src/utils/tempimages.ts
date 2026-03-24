import { lstat, readdir, rm, stat, writeFile } from "node:fs/promises";
import process from "node:process";
import type { FluxerClient, FluxerMessage } from "./types.ts";
import { getString } from "./i18n.ts";
import logger from "./logger.ts";
import { getType } from "./media.ts";
import { selectedImages } from "./collections.ts";

type SizeSuffix = "K" | "M" | "G" | "T";
type FileStats = { name: string; size: number; ctime: Date };

let dirSizeCache = 0;
let threshold: number | undefined;

export async function upload(
  client: FluxerClient,
  result: { name: string; data: Buffer; flags?: number },
  context: FluxerMessage,
) {
  const ext = result.name.split(".").pop() ?? "png";
  const filename = `${Math.random().toString(36).substring(2, 15)}.${ext}`;
  await writeFile(`${process.env.TEMPDIR}/${filename}`, result.data);
  const imageURL = `${process.env.TMP_DOMAIN || "https://tmp.esmbot.net"}/${filename}`;

  await client.rest.createMessage(context.channel_id, {
    content: imageURL,
    message_reference: {
      message_id: context.id,
      channel_id: context.channel_id,
      guild_id: context.guild_id,
      fail_if_not_exists: false,
    },
    allowed_mentions: { replied_user: false },
  });

  if (threshold) {
    const size = dirSizeCache + result.data.length;
    dirSizeCache = size;
    await removeOldImages(size);
  }
}

async function removeOldImages(s: number) {
  if (!threshold) return;
  if (!process.env.TEMPDIR || process.env.TEMPDIR === "") return;
  let size = s;
  if (size > threshold) {
    const files = (await readdir(process.env.TEMPDIR)).map(async (file) => {
      const stats = await lstat(`${process.env.TEMPDIR}/${file}`);
      if (stats.isSymbolicLink()) return;
      return { name: file, size: stats.size, ctime: stats.ctime } as FileStats;
    });
    const resolvedFiles = await Promise.all(files);
    const oldestFiles = resolvedFiles
      .filter((item): item is FileStats => !!item)
      .sort((a, b) => a.ctime.getTime() - b.ctime.getTime());

    do {
      if (!oldestFiles[0]) break;
      await rm(`${process.env.TEMPDIR}/${oldestFiles[0].name}`);
      logger.log("main", `Removed oldest image file: ${oldestFiles[0].name}`);
      size -= oldestFiles[0].size;
      oldestFiles.shift();
    } while (size > threshold);

    dirSizeCache = oldestFiles.reduce((a, b) => a + b.size, 0);
  }
}

export async function parseThreshold() {
  if (!process.env.THRESHOLD || process.env.THRESHOLD === "") return;
  if (!process.env.TEMPDIR || process.env.TEMPDIR === "") return;
  const matched = process.env.THRESHOLD.match(/(\d+)([KMGT])/);
  const sizes = { K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 };
  if (matched?.[1] && matched[2]) {
    threshold = Number(matched[1]) * sizes[matched[2] as SizeSuffix];
  } else {
    logger.error("Invalid THRESHOLD config.");
    threshold = undefined;
  }
  const dirstat = (await readdir(process.env.TEMPDIR)).map((file) =>
    stat(`${process.env.TEMPDIR}/${file}`).then((s) => s.size),
  );
  dirSizeCache = (await Promise.all(dirstat)).reduce((a, b) => a + b, 0);
}