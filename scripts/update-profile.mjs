import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { graphql } from "@octokit/graphql";

const PROFILE_LOGIN = process.env.PROFILE_LOGIN || "seungwonme";
const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../assets/imessage.svg",
);
const WIDTH = 640;
const MESSAGE_LINE_HEIGHT = 30;

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

function wrapText(value, maxLength = 58, maxLines = 2) {
  const words = String(value || "No description yet.").trim().split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxLength) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  if (lines.join(" ").length < words.join(" ").length && lines.length) {
    lines[lines.length - 1] = `${lines.at(-1).replace(/[.,;:]?$/, "")}…`;
  }
  return lines.slice(0, maxLines);
}

function seoulWeekday(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "long",
  }).format(now);
}

async function fetchPinnedRepositories(token) {
  if (!token) throw new Error("GH_TOKEN is required to read pinned repositories.");

  const request = graphql.defaults({
    headers: { authorization: `token ${token}` },
  });
  const data = await request(
    `query PinnedRepositories($login: String!) {
      user(login: $login) {
        pinnedItems(first: 6, types: [REPOSITORY]) {
          nodes {
            ... on Repository {
              nameWithOwner
              description
              url
              stargazerCount
              primaryLanguage { name color }
            }
          }
        }
      }
    }`,
    { login: PROFILE_LOGIN },
  );
  const repositories = data.user?.pinnedItems?.nodes?.filter(Boolean) || [];
  if (!repositories.length) throw new Error("No pinned repositories were returned.");
  return repositories;
}

function textLines(lines, x, y, className, lineHeight = 34) {
  return `<text x="${x}" y="${y}" class="${className}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function tail(side, x, y, width, height, tone) {
  const bottom = y + height;
  if (side === "incoming") {
    return `<path d="M ${x + 20} ${bottom - 16} L ${x + 17} ${bottom - 4} C ${x + 12} ${bottom + 2}, ${x + 4} ${bottom + 5}, ${x - 5} ${bottom + 6} C ${x + 4} ${bottom + 2}, ${x + 8} ${bottom - 4}, ${x + 10} ${bottom - 13} Z" class="${tone}"/>`;
  }
  const right = x + width;
  return `<path d="M ${right - 20} ${bottom - 16} L ${right - 17} ${bottom - 4} C ${right - 12} ${bottom + 2}, ${right - 4} ${bottom + 5}, ${right + 5} ${bottom + 6} C ${right - 4} ${bottom + 2}, ${right - 8} ${bottom - 4}, ${right - 10} ${bottom - 13} Z" class="${tone}"/>`;
}

function messageBubble({ side, y, width, lines, delay, secondary = false }) {
  const height = 48 + (lines.length - 1) * MESSAGE_LINE_HEIGHT;
  const x = side === "incoming" ? 8 : WIDTH - width - 8;
  const tone = side === "incoming" ? "incoming-fill" : "outgoing-fill";
  const textClass = secondary ? "message-secondary" : "message-text";
  const textY = y + (height - (lines.length - 1) * MESSAGE_LINE_HEIGHT) / 2 + 8;
  return `<g class="message ${side}" style="animation-delay:${delay}s">
    ${tail(side, x, y, width, height, tone)}
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="24" class="${tone}"/>
    ${textLines(lines, x + 22, textY, textClass, MESSAGE_LINE_HEIGHT)}
  </g>`;
}

function repositoryBubble(repository, index, y, isLast) {
  const width = 550;
  const x = WIDTH - width - 8;
  const descriptions = wrapText(repository.description, 52, 1);
  const height = 60;
  const language = repository.primaryLanguage?.name || "Repository";
  const stars = repository.stargazerCount ? ` · ★ ${repository.stargazerCount}` : "";
  const delay = (1.9 + index * 0.22).toFixed(2);
  return {
    height,
    svg: `<g class="message outgoing" style="animation-delay:${delay}s">
      ${isLast ? `${tail("outgoing", x, y, width, height, "outgoing-fill")}\n      ` : ""}<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" class="outgoing-fill"/>
      <text x="${x + 20}" y="${y + 23}" class="repo-title">${escapeXml(repository.nameWithOwner)}</text>
      <text x="${x + width - 18}" y="${y + 22}" text-anchor="end" class="repo-meta">${escapeXml(language + stars)}</text>
      ${textLines(descriptions, x + 20, y + 47, "repo-description", 20)}
    </g>`,
  };
}

function renderSvg({ repositories, now = new Date() }) {
  const messages = [];
  let y = 16;

  messages.push(
    messageBubble({
      side: "outgoing",
      y,
      width: 220,
      lines: ["Hey, I’m Aiden 👋"],
      delay: ".12",
    }),
  );
  y += 62;
  messages.push(
    messageBubble({
      side: "incoming",
      y,
      width: 200,
      lines: ["What do you do?"],
      delay: ".5",
    }),
  );
  y += 62;
  messages.push(
    messageBubble({
      side: "outgoing",
      y,
      width: 330,
      lines: ["I focus on working AI-native."],
      delay: ".88",
    }),
  );
  y += 62;
  messages.push(
    messageBubble({
      side: "incoming",
      y,
      width: 320,
      lines: ["What are you building now?"],
      delay: "1.26",
    }),
  );
  y += 62;

  for (const [index, repository] of repositories.entries()) {
    const bubble = repositoryBubble(repository, index, y, index === repositories.length - 1);
    messages.push(bubble.svg);
    y += bubble.height + 6;
  }

  const height = y + 26;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Aiden's GitHub profile conversation</title>
  <desc id="desc">A compact iMessage-style introduction and repositories pinned by seungwonme.</desc>
  <defs>
    <linearGradient id="imessage-blue" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${height}">
      <stop offset="0" stop-color="#2597ff"/>
      <stop offset="1" stop-color="#0091ff"/>
    </linearGradient>
  </defs>
  <style>
    .canvas { fill: #1e1e1e; }
    .incoming-fill { fill: #3b3b3d; }
    .outgoing-fill { fill: url(#imessage-blue); }
    .message-text { fill: #ffffff; font: 400 24px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; letter-spacing: -.3px; }
    .message-secondary { fill: #e1e1e1; font: 400 24px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; }
    .repo-title { fill: #ffffff; font: 650 21px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; letter-spacing: -.2px; }
    .repo-description { fill: #ffffff; font: 400 16px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; }
    .repo-meta { fill: #d7edff; font: 600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; }
    .receipt { fill: #9a9a9a; font: 600 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; }
    .message { opacity: 1; }
    @media (prefers-reduced-motion: no-preference) and (update: fast) {
      .message { transform-box: fill-box; animation: message-in .26s cubic-bezier(.2,.8,.2,1) backwards; }
      .message.incoming { transform-origin: left bottom; }
      .message.outgoing { transform-origin: right bottom; }
      @keyframes message-in { from { opacity: 0; transform: translateY(4px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    }
  </style>
  <rect width="${WIDTH}" height="${height}" class="canvas"/>
  ${messages.join("\n  ")}
  <text x="${WIDTH - 20}" y="${height - 12}" text-anchor="end" class="receipt">Read: ${escapeXml(seoulWeekday(now))}</text>
</svg>
`;
}

async function writeAtomically(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, path);
}

function selfTest() {
  assert.equal(escapeXml('<Aiden & "friends">'), "&lt;Aiden &amp; &quot;friends&quot;&gt;");
  assert.deepEqual(wrapText("one two three four", 7, 2), ["one two", "three…"]);
  const svg = renderSvg({
    repositories: [
      {
        nameWithOwner: "seungwonme/test",
        description: "A test repository",
        stargazerCount: 1,
        primaryLanguage: { name: "JavaScript" },
      },
    ],
    now: new Date("2026-07-16T00:00:00Z"),
  });
  assert.match(svg, /seungwonme\/test/);
  assert.match(svg, /width="640"/);
  assert.match(svg, /What do you do\?/);
  assert.doesNotMatch(svg, /weather|forecast/i);
  assert.match(svg, /Read: Thursday/);
  console.log("Self-test passed.");
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  const repositories = await fetchPinnedRepositories(process.env.GH_TOKEN);
  const svg = renderSvg({ repositories });
  await writeAtomically(OUTPUT_PATH, svg);
  console.log(`Updated ${OUTPUT_PATH} with ${repositories.length} pinned repositories.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
