import messages from "#config/messages.json" with { type: "json" };
import { runningCommands, selectedImages } from "#utils/collections.js";
import { runMediaJob } from "#utils/media.js";
import mediaDetect, { type MediaMeta } from "#utils/mediadetect.js";
import { clean, isEmpty, random } from "#utils/misc.js";
import type { CreateMessageData, ExtendedConstructedCommandOptions, MediaParams } from "#utils/types.js";
import Command from "./command.ts";

class MediaCommand extends Command {
  params?: object;

  paramsFunc(_url?: string, _name?: string): object {
    return {};
  }

  async criteria(_text?: string | number | boolean): Promise<boolean> {
    return true;
  }

  async run(): Promise<string | CreateMessageData | undefined> {
    this.success = false;

    if (!this.hasPermission("ATTACH_FILES")) return this.getString("permissions.noAttachFiles");

    const timestamp = this.message.timestamp ? new Date(this.message.timestamp) : new Date();

    // Debounce: don't re-run the same command within 5 s for this user
    if (
      runningCommands.has(this.author?.id) &&
      runningCommands.get(this.author?.id)!.getTime() - timestamp.getTime() < 5000
    ) {
      return this.getString("image.slowDown");
    }
    runningCommands.set(this.author.id, timestamp);

    const staticProps = this.constructor as typeof MediaCommand;

    let mediaParams: MediaParams;

    let needsSpoiler = false;
    if (staticProps.requiresImage) {
      try {
        let selection: MediaMeta | undefined;
        if (!this.getOptionAttachment("image") && !this.getOptionString("link")) {
          selection = selectedImages.get(this.author.id);
        }
        const image =
          selection ??
          (await mediaDetect(
            this.client,
            this.permissions,
            staticProps.supportedTypes,
            this.message,
            undefined,
            true,
          ).catch((e: Error) => {
            if (e.name === "AbortError") {
              runningCommands.delete(this.author.id);
              return this.getString("image.timeout");
            }
            throw e;
          }));
        if (image === undefined) {
          runningCommands.delete(this.author.id);
          return `${staticProps.noImage} ${this.getString("image.tip", { params: { name: this.client.user.global_name ?? this.client.user.username } })}`;
        }
        if (typeof image === "string") return image;
        selectedImages.delete(this.author.id);
        needsSpoiler = image.spoiler;
        if (image.type === "large") {
          runningCommands.delete(this.author.id);
          return this.getString("image.large");
        }
        if (image.type === "tenorlimit") {
          runningCommands.delete(this.author.id);
          return this.getString("image.tenor");
        }
        if (image.type === "klipylimit") {
          runningCommands.delete(this.author.id);
          return this.getString("image.klipy");
        }
        if (image.type === "badurl") {
          runningCommands.delete(this.author.id);
          return this.getString("image.badurl");
        }
        mediaParams = {
          cmd: staticProps.command,
          type: image.mediaType ?? "image",
          params: {},
          input: { type: image.type },
          id: this.message.id,
          path: image.path,
          url: image.url,
          name: image.name,
          onlyAnim: !!staticProps.requiresAnim,
        };
      } catch (e) {
        runningCommands.delete(this.author.id);
        throw e;
      }
    } else {
      mediaParams = {
        cmd: staticProps.command,
        type: "image",
        params: {},
        id: this.message.id,
      };
    }

    const spoilerFlag = this.getOptionBoolean("spoiler");
    if (spoilerFlag != null) needsSpoiler = spoilerFlag;

    if (staticProps.requiresParam) {
      const text = this.getOptionString(staticProps.requiredParam, true) ?? this.args.join(" ").trim();
      if (!text || (typeof text === "string" && isEmpty(text)) || !(await this.criteria(text))) {
        runningCommands.delete(this.author?.id);
        return staticProps.noParam;
      }
    }

    if (this.params) {
      Object.assign(mediaParams.params, this.params);
    } else {
      Object.assign(mediaParams.params, this.paramsFunc(mediaParams.url, mediaParams.name));
    }

    // Show a processing message for animated inputs
    let status: FluxerMessageRef | undefined;
    if (
      mediaParams.input &&
      (mediaParams.input.type === "image/gif" || mediaParams.input.type === "image/webp")
    ) {
      try {
        const sent = await this.client.rest.createMessage(this.message.channel_id, {
          content: `${random(messages.emotes) || "⚙️"} ${this.getString("image.processing")}`,
        });
        status = { channel_id: sent.channel_id, id: sent.id };
      } catch {
        // ignore; status message is optional
      }
    }

    try {
      const result = await runMediaJob(mediaParams);
      const buffer = result.buffer;
      const type = result.type;

      if (type === "frames") return this.getString("image.frames");
      if (type === "unknown") return this.getString("image.unknown");
      if (type === "noresult") return this.getString("image.noResult");
      if (type === "ratelimit") return this.getString("image.ratelimit");
      if (type === "nocmd") return this.getString("image.nocmd");
      if (type === "noanim" && staticProps.requiresAnim) return this.getString("image.noanim");
      if (type === "empty") return staticProps.empty;

      this.success = true;

      if (type === "text") {
        return { content: `\`\`\`\n${clean(buffer.toString("utf8"), [], true)}\n\`\`\`` };
      }

      return {
        files: [
          {
            name: `${needsSpoiler ? "SPOILER_" : ""}${staticProps.command}.${type}`,
            data: buffer,
          },
        ],
      };
    } catch (e) {
      const err = e as Error;
      if (err.toString().includes("media_not_working")) return this.getString("image.notWorking");
      if (err.toString().includes("Request ended prematurely due to a closed connection"))
        return this.getString("image.tryAgain");
      if (err.toString().includes("media_job_killed") || err.toString().includes("Timeout"))
        return this.getString("image.tooLong");
      if (err.toString().includes("No available servers")) return this.getString("image.noServers");
      throw err;
    } finally {
      if (status) {
        try {
          await this.client.rest.deleteMessage(status.channel_id, status.id);
        } catch {
          // ignore
        }
      }
      runningCommands.delete(this.author?.id);
    }
  }

  static addTextParam() {
    this.flags.unshift({
      name: "text",
      type: "string",
      description: "The text to put on the image",
      maxLength: 4096,
      required: !this.textOptional,
      classic: true,
    });
  }

  static init() {
    this.flags = [];
    if (this.requiresImage) {
      this.flags.push(
        { name: "link", type: "string", description: "An image/GIF URL", classic: true },
      );
    }
    return this;
  }

  static allowedFonts = [
    "futura",
    "impact",
    "helvetica",
    "arial",
    "roboto",
    "noto",
    "times",
    "comic sans ms",
    "ubuntu",
  ];

  static supportedTypes: MediaParams["type"][] = ["image"];

  static requiresImage = true;
  static requiresParam = false;
  static requiredParam = "text";
  static requiredParamType: ExtendedConstructedCommandOptions["type"] = "string";
  static textOptional = false;
  static requiresAnim = false;
  static alwaysGIF = false;
  static noImage = "You need to provide an image/GIF!";
  static noParam = "You need to provide some text!";
  static empty = "The resulting output was empty!";
  static command = "";
}

type FluxerMessageRef = { channel_id: string; id: string };

export default MediaCommand;