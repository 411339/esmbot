import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Command from "#cmd-classes/command.js";
import commandConfig from "#config/commands.json" with { type: "json" };
import { aliases, categories, commands, paths } from "./collections.ts";
import { debug, log } from "./logger.ts";
import type { CommandsConfig, ExtCommand, ExtendedConstructedCommandOptions, Param } from "./types.ts";

let queryValue = 0;

const basePath = dirname(fileURLToPath(import.meta.url));
const cmdPath = resolve(basePath, "..", "..", "commands");

const blacklist = (commandConfig as CommandsConfig).blacklist;

/**
 * Load a command into memory.
 */
export async function load(command: string): Promise<{ props: ExtCommand; name: string } | undefined> {
  log("main", `Loading command from ${command}...`);
  const { default: props } = (await import(`${command}?v=${queryValue}`)) as { default: ExtCommand };
  queryValue++;

  const relPath = relative(cmdPath, command);
  const commandArray = relPath.split("/");
  const commandName = commandArray[commandArray.length - 1].split(".")[0];
  const category = commandArray[0];
  const subPath = commandArray.slice(1, -1);

  // Skip message/user context menu commands (Fluxer has no slash commands yet)
  if (category === "message" || category === "user") {
    log("warn", `Skipping context menu command ${command} (not supported on Fluxer)`);
    return;
  }

  if (!(props?.prototype instanceof Command)) {
    log("warn", `Command ${command} is invalid, skipping...`);
    return;
  }

  let fullCommandName = commandName;
  if (subPath.length > 0) fullCommandName = `${subPath.join(" ")} ${commandName}`;

  if (blacklist.includes(subPath[0]) || blacklist.includes(fullCommandName)) {
    log("warn", `Skipped loading blacklisted command ${command}...`);
    return;
  }

  props.init();
  props.baseCommand = false;
  props.category = category;
  props.params = parseFlags(props.flags);

  paths.set(fullCommandName, command);

  const subdir = relPath.split(".")[0];
  const resolved = resolve(cmdPath, subdir);

  let files;
  try {
    files = await readdir(resolved, { withFileTypes: true });
  } catch {
    debug(`Could not find subcommand dir at ${resolved}`);
  }

  if (files) {
    props.baseCommand = true;
    props.flags = [];
    for (const file of files) {
      if (!file.isFile()) continue;
      const sub = await load(resolve(resolved, file.name));
      if (!sub) continue;
      const split = sub.name.split(" ");
      const subName = split[split.length - 1];
      props.flags.push({
        name: subName,
        type: "string",
        description: sub.props.description,
        options: sub.props.flags as ExtendedConstructedCommandOptions[],
      });
    }
  }

  commands.set(fullCommandName, props);

  const categoryCommands = categories.get(category) ?? new Set<string>();
  categoryCommands.add(fullCommandName);
  categories.set(category, categoryCommands);

  if (props.aliases) {
    for (const alias of props.aliases) {
      aliases.set(alias, fullCommandName);
      paths.set(alias, command);
    }
  }

  return { props, name: fullCommandName };
}

function parseFlags(flags: ExtendedConstructedCommandOptions[]): Param[] {
  const params: Param[] = [];
  for (const flag of flags) {
    if (flag.options) {
      const sub = { name: flag.name, desc: flag.description, params: parseFlags(flag.options) };
      params.push(sub);
    } else {
      if (!flag.classic) continue;
      params.push(`${flag.required ? "[" : "{"}${flag.name}${flag.required ? "]" : "}"}`);
    }
  }
  return params;
}

export const flagMap: string[] = [
  "",
  "",
  "",
  "string",
  "integer",
  "boolean",
  "user",
  "channel",
  "role",
  "mentionable",
  "number",
  "attachment",
];