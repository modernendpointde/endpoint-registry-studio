import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HELP_GROUP_ORDER,
  HELP_TOPICS,
  type HelpBlock,
  type HelpGroup,
} from "../src/features/help/helpTopics";

/**
 * Writes the in-application guide to a Markdown file so the text can be reviewed outside the
 * application. The output is generated, never edited by hand.
 */
const targetArgument = process.argv[2];
const target = targetArgument
  ? resolve(targetArgument)
  : join(dirname(fileURLToPath(import.meta.url)), "..", "tmp", "help-guide.md");

function anchor(title: string): string {
  return (
    "#" +
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
  );
}

function titleById(id: string): string {
  return HELP_TOPICS.find((topic) => topic.id === id)?.title ?? id;
}

function renderBlock(block: HelpBlock): string {
  switch (block.kind) {
    case "text":
      return block.text;
    case "heading":
      return `#### ${block.text}`;
    case "steps":
      return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
    case "example":
      return [
        `**${block.example.title}**`,
        "",
        "```text",
        ...block.example.lines,
        "```",
        ...(block.example.note ? ["", block.example.note] : []),
      ].join("\n");
    case "note":
      return `> ${block.text}`;
    case "ref":
      return `${block.text} [${titleById(block.topicId)}](${anchor(titleById(block.topicId))}).`;
  }
}

const lines: string[] = ["# How this works", ""];

const groups: HelpGroup[] = HELP_GROUP_ORDER.filter((group) =>
  HELP_TOPICS.some((topic) => topic.group === group),
);

for (const group of groups) {
  lines.push(`## ${group}`, "");
  for (const topic of HELP_TOPICS.filter((entry) => entry.group === group)) {
    lines.push(`### ${topic.title}`, "");
    if (topic.summary) lines.push(topic.summary, "");
    for (const block of topic.blocks) {
      lines.push(renderBlock(block), "");
    }
  }
}

const markdown = lines.join("\n").replace(/\n{3,}/g, "\n\n");
const words = markdown.split(/\s+/).filter(Boolean).length;

await mkdir(dirname(target), { recursive: true });
await writeFile(target, markdown, "utf8");

process.stdout.write(
  `Wrote the guide to ${target}\n  topics: ${String(HELP_TOPICS.length)}\n  words:  ${String(words)}\n`,
);
