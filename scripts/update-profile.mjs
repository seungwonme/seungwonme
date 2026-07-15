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
const SEOUL = { latitude: "37.5665", longitude: "126.9780" };

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

function wrapText(value, maxLength = 62, maxLines = 2) {
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

  const consumed = lines.join(" ").length;
  if (consumed < words.join(" ").length && lines.length) {
    lines[lines.length - 1] = `${lines.at(-1).replace(/[.,;:]?$/, "")}…`;
  }
  return lines.slice(0, maxLines);
}

function weatherEmoji(id, icon = "") {
  if (id >= 200 && id < 300) return "⛈️";
  if (id >= 300 && id < 400) return "🌦️";
  if (id >= 500 && id < 600) return "🌧️";
  if (id >= 600 && id < 700) return "❄️";
  if (id >= 700 && id < 800) return "🌫️";
  if (id === 800) return icon.endsWith("n") ? "🌙" : "☀️";
  if (id === 801) return "🌤️";
  return "☁️";
}

function seoulDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "long",
    month: "long",
    day: "numeric",
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

async function fetchWeather(apiKey) {
  if (!apiKey) throw new Error("OPENWEATHER_API_KEY is required.");

  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.search = new URLSearchParams({
    ...SEOUL,
    appid: apiKey,
    units: "metric",
    lang: "en",
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`OpenWeather returned HTTP ${response.status}.`);

  const data = await response.json();
  const condition = data.weather?.[0];
  if (
    typeof data.main?.temp !== "number" ||
    typeof data.main?.feels_like !== "number" ||
    typeof condition?.id !== "number"
  ) {
    throw new Error("OpenWeather returned an unexpected response.");
  }
  return {
    temperature: Math.round(data.main.temp),
    feelsLike: Math.round(data.main.feels_like),
    description: condition.description,
    emoji: weatherEmoji(condition.id, condition.icon),
  };
}

function textLines(lines, x, y, className, lineHeight = 22) {
  return `<text x="${x}" y="${y}" class="${className}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function repositoryBubble(repository, index, y) {
  const description = wrapText(repository.description);
  const language = repository.primaryLanguage?.name || "Repository";
  const stars = repository.stargazerCount ? ` · ★ ${repository.stargazerCount}` : "";
  const delay = (1.65 + index * 0.2).toFixed(2);
  return `<g class="message incoming" style="animation-delay:${delay}s">
    <rect x="42" y="${y}" width="706" height="94" rx="24" class="bubble secondary"/>
    ${textLines([repository.nameWithOwner], 66, y + 29, "repo-title", 20)}
    ${textLines(description, 66, y + 54, "repo-description", 19)}
    <text x="722" y="${y + 29}" text-anchor="end" class="repo-meta">${escapeXml(language + stars)}</text>
  </g>`;
}

function renderSvg({ repositories, weather, now = new Date(), preview = false }) {
  const projectsStart = 468;
  const projectGap = 108;
  const height = projectsStart + repositories.length * projectGap + 88;
  const weatherLine = preview
    ? "Seoul · Weather API awaiting setup"
    : `Seoul · ${weather.emoji} ${weather.temperature}°C · ${weather.description}`;
  const feelsLike = preview
    ? "Add OPENWEATHER_API_KEY to enable live weather"
    : `Feels like ${weather.feelsLike}°C · ${seoulDate(now)}`;
  const projectBubbles = repositories
    .map((repository, index) =>
      repositoryBubble(repository, index, projectsStart + index * projectGap),
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Aiden's live GitHub profile conversation</title>
  <desc id="desc">An iMessage-style profile showing Seoul weather, today's date, and repositories pinned by seungwonme.</desc>
  <style>
    :root { color-scheme: light dark; }
    .canvas { fill: #f5f5f7; }
    .panel { fill: #ffffff; stroke: #d2d2d7; }
    .header { fill: #f8f8fa; }
    .divider { stroke: #d9d9de; }
    .title { fill: #161617; font: 700 19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .status { fill: #6e6e73; font: 500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .bubble.primary { fill: #0a84ff; }
    .bubble.secondary { fill: #e9e9eb; }
    .body-light { fill: #ffffff; font: 500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .body-dark { fill: #161617; font: 500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .subtle-light { fill: #dcecff; font: 500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .subtle-dark { fill: #66666b; font: 500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .repo-title { fill: #161617; font: 700 15px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .repo-description { fill: #4b4b50; font: 500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .repo-meta { fill: #6e6e73; font: 600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .credit { fill: #77777c; font: 500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .message { animation: message-in .42s cubic-bezier(.2,.8,.2,1) backwards; }
    @keyframes message-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-color-scheme: dark) {
      .canvas { fill: #0d1117; }
      .panel { fill: #161b22; stroke: #30363d; }
      .header { fill: #1c2128; }
      .divider { stroke: #30363d; }
      .title, .body-dark, .repo-title { fill: #f0f6fc; }
      .status, .subtle-dark, .repo-meta, .credit { fill: #8b949e; }
      .bubble.secondary { fill: #30363d; }
      .repo-description { fill: #c9d1d9; }
    }
    @media (prefers-reduced-motion: reduce) { .message { animation: none; } }
  </style>
  <rect width="900" height="${height}" rx="28" class="canvas"/>
  <rect x="18" y="18" width="864" height="${height - 36}" rx="24" class="panel"/>
  <path d="M42 18h816a24 24 0 0 1 24 24v62H18V42a24 24 0 0 1 24-24Z" class="header"/>
  <line x1="18" y1="104" x2="882" y2="104" class="divider"/>
  <circle cx="450" cy="55" r="23" fill="#0a84ff"/>
  <text x="450" y="62" text-anchor="middle" class="body-light">A</text>
  <text x="450" y="91" text-anchor="middle" class="title">Aiden</text>
  <circle cx="476" cy="91" r="4" fill="#30d158"/>

  <g class="message incoming" style="animation-delay:.15s">
    <rect x="42" y="132" width="292" height="58" rx="24" class="bubble secondary"/>
    <text x="66" y="168" class="body-dark">Hey, I’m Aiden 👋</text>
  </g>
  <g class="message outgoing" style="animation-delay:.55s">
    <rect x="226" y="204" width="632" height="78" rx="24" class="bubble primary"/>
    ${textLines(["I build AI-native systems that turn", "information into useful work."], 250, 236, "body-light", 24)}
  </g>
  <g class="message incoming" style="animation-delay:.95s">
    <rect x="42" y="296" width="548" height="78" rx="24" class="bubble secondary"/>
    <text x="66" y="328" class="body-dark">${escapeXml(weatherLine)}</text>
    <text x="66" y="353" class="subtle-dark">${escapeXml(feelsLike)}</text>
  </g>
  <g class="message outgoing" style="animation-delay:1.35s">
    <rect x="410" y="390" width="448" height="58" rx="24" class="bubble primary"/>
    <text x="434" y="426" class="body-light">Here’s what I’m building right now ↓</text>
  </g>

  ${projectBubbles}
  <text x="450" y="${height - 42}" text-anchor="middle" class="credit">Updated by Node.js + GitHub GraphQL + OpenWeather · Weather data provided by OpenWeather</text>
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
  assert.equal(weatherEmoji(800, "01d"), "☀️");
  assert.equal(weatherEmoji(800, "01n"), "🌙");
  assert.match(
    renderSvg({
      repositories: [
        {
          nameWithOwner: "seungwonme/test",
          description: "A test repository",
          stargazerCount: 1,
          primaryLanguage: { name: "JavaScript" },
        },
      ],
      weather: { temperature: 24, feelsLike: 25, description: "clear sky", emoji: "☀️" },
      now: new Date("2026-07-15T00:00:00Z"),
    }),
    /seungwonme\/test/,
  );
  console.log("Self-test passed.");
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  const preview = process.argv.includes("--preview");
  const repositories = await fetchPinnedRepositories(process.env.GH_TOKEN);
  const weather = preview ? null : await fetchWeather(process.env.OPENWEATHER_API_KEY);
  const svg = renderSvg({ repositories, weather, preview });
  await writeAtomically(OUTPUT_PATH, svg);
  console.log(`Updated ${OUTPUT_PATH} with ${repositories.length} pinned repositories.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
