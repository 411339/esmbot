import { promises } from "node:fs";
import process from "node:process";
import commandConfig from "#config/commands.json" with { type: "json" };
import { commands } from "./collections.ts";
import type { CommandsConfig, Param } from "./types.ts";

export const categoryTemplate = {
  general: [] as string[],
  tags: ["> **Every command in this category is a subcommand of the tag command.**\n"] as string[],
  "image-editing": ["> **These commands support the PNG, JPEG, WEBP, AVIF (static only), and GIF formats.**\n"] as string[],
};
export let categories: { [key: string]: string[] } = { ...categoryTemplate };

export let generated = false;

function generateEntries(baseName: string, params: Param[], desc: string, category: string) {
  let entry = `**${baseName}**`;
  const sorted = [];
  let generatedSub = false;
  for (const param of params) {
    if (typeof param !== "string") {
      generateEntries(`${baseName} ${param.name}`, param.params ?? [], param.desc, category);
      generatedSub = true;
    } else {
      sorted.push(param);
    }
  }
  if (generatedSub) return;
  entry += `${sorted.length > 0 ? ` ${sorted.join(" ")}` : ""} - ${desc}`;
  if (!categories[category]) categories[category] = [];
  categories[category].push(entry);
}

export function generateList() {
  categories = { ...categoryTemplate };
  for (const [command, cmd] of commands) {
    if (!cmd) throw Error(`Command info missing for ${command}`);
    if (cmd.baseCommand) continue;
    if (!categories[cmd.category]) categories[cmd.category] = [];
    if (command !== "music") generateEntries(command, cmd.params, cmd.description, cmd.category);
  }
  generated = true;
}

export async function createPage(output: string) {
  let template = `# <img src="https://esmbot.net/pictures/esmbot.png" width="64"> esmBot${process.env.NODE_ENV === "development" ? " Dev" : ""} Command List (Fluxer edition)

This page was last generated on \`${new Date().toString()}\`.

\`[]\` means an argument is required, \`{}\` means an argument is optional.

**Want to help support esmBot's development? Consider leaving a tip on Ko-fi!** https://ko-fi.com/TheEssem
`;

  template += "\n## Table of Contents\n";
  for (const category of Object.keys(categories)) {
    const display = category.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    template += `+ [**${display}**](#${category})\n`;
  }

  for (const category of Object.keys(categories)) {
    const display = category.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    template += `\n## ${display}\n`;
    for (const command of categories[category]) {
      if (command.startsWith(">")) {
        template += `${command}\n`;
      } else {
        template += `+ ${command}\n`;
      }
    }
  }

  await promises.writeFile(output, template);
}