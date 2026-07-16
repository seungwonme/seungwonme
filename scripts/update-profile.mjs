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
const WIDTH = 1000;
const SEOUL = { latitude: "37.5665", longitude: "126.9780" };

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

function weatherDetails(symbolCode) {
  const symbol = String(symbolCode).toLowerCase();
  const isNight = symbol.endsWith("_night");
  if (symbol.startsWith("clearsky")) {
    return { emoji: isNight ? "🌙" : "☀", description: "clear sky" };
  }
  if (symbol.startsWith("fair")) {
    return { emoji: isNight ? "🌙" : "🌤", description: "mainly clear" };
  }
  if (symbol.startsWith("partlycloudy")) return { emoji: "⛅", description: "partly cloudy" };
  if (symbol.startsWith("cloudy")) return { emoji: "☁", description: "cloudy" };
  if (symbol.includes("fog")) return { emoji: "🌫", description: "foggy" };
  if (symbol.includes("thunder")) return { emoji: "⛈", description: "thunderstorm" };
  if (symbol.includes("snow")) return { emoji: "❄", description: "snow" };
  if (symbol.includes("sleet")) return { emoji: "🌨", description: "sleet" };
  if (symbol.includes("rain")) return { emoji: "🌧", description: "rain" };
  return { emoji: "🌡️", description: "changing weather" };
}

function seoulDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
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

async function fetchWeather() {
  const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
  url.search = new URLSearchParams({
    lat: SEOUL.latitude,
    lon: SEOUL.longitude,
  });
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "seungwonme-profile/1.0 github.com/seungwonme",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`MET Norway returned HTTP ${response.status}.`);
  return parseWeather(await response.json());
}

function parseWeather(data) {
  const forecast = data.properties?.timeseries?.[0]?.data;
  const instant = forecast?.instant?.details;
  const symbolCode =
    forecast?.next_1_hours?.summary?.symbol_code ||
    forecast?.next_6_hours?.summary?.symbol_code;
  if (
    typeof instant?.air_temperature !== "number" ||
    typeof instant?.relative_humidity !== "number" ||
    typeof instant?.wind_speed !== "number" ||
    typeof symbolCode !== "string"
  ) {
    throw new Error("MET Norway returned an unexpected response.");
  }
  return {
    temperature: Math.round(instant.air_temperature),
    humidity: Math.round(instant.relative_humidity),
    windSpeed: Math.round(instant.wind_speed),
    ...weatherDetails(symbolCode),
  };
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

function messageBubble({ side, y, width, height, lines, delay, secondary = false }) {
  const x = side === "incoming" ? 8 : WIDTH - width - 8;
  const tone = side === "incoming" ? "incoming-fill" : "outgoing-fill";
  const textClass = secondary ? "message-secondary" : "message-text";
  const textY = y + (height - (lines.length - 1) * 34) / 2 + 9;
  return `<g class="message ${side}" style="animation-delay:${delay}s">
    ${tail(side, x, y, width, height, tone)}
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="31" class="${tone}"/>
    ${textLines(lines, x + 25, textY, textClass)}
  </g>`;
}

function repositoryBubble(repository, index, y, isLast) {
  const width = 740;
  const x = WIDTH - width - 8;
  const descriptions = wrapText(repository.description);
  const height = descriptions.length > 1 ? 112 : 92;
  const language = repository.primaryLanguage?.name || "Repository";
  const stars = repository.stargazerCount ? ` · ★ ${repository.stargazerCount}` : "";
  const delay = (1.9 + index * 0.22).toFixed(2);
  return {
    height,
    svg: `<g class="message outgoing" style="animation-delay:${delay}s">
      ${isLast ? `${tail("outgoing", x, y, width, height, "outgoing-fill")}\n      ` : ""}<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="27" class="outgoing-fill"/>
      <text x="${x + 23}" y="${y + 31}" class="repo-title">${escapeXml(repository.nameWithOwner)}</text>
      ${textLines(descriptions, x + 23, y + 58, "repo-description", 23)}
      <text x="${x + width - 22}" y="${y + height - 13}" text-anchor="end" class="repo-meta">${escapeXml(language + stars)}</text>
    </g>`,
  };
}

function renderSvg({ repositories, weather, now = new Date() }) {
  const messages = [];
  let y = 24;

  messages.push(
    messageBubble({
      side: "incoming",
      y,
      width: 335,
      height: 58,
      lines: ["Hey, I’m Aiden 👋"],
      delay: ".12",
    }),
  );
  y += 84;
  messages.push(
    messageBubble({
      side: "outgoing",
      y,
      width: 700,
      height: 88,
      lines: ["I build AI-native systems that turn", "information into useful work."],
      delay: ".5",
    }),
  );
  y += 118;
  messages.push(
    messageBubble({
      side: "incoming",
      y,
      width: 370,
      height: 58,
      lines: ["How’s Seoul today?"],
      delay: ".88",
    }),
  );
  y += 84;
  messages.push(
    messageBubble({
      side: "outgoing",
      y,
      width: 670,
      height: 116,
      lines: [
        `${weather.emoji} ${weather.temperature}°C · ${weather.description}`,
        `Humidity ${weather.humidity}% · Wind ${weather.windSpeed} m/s`,
        seoulDate(now),
      ],
      delay: "1.26",
    }),
  );
  y += 146;
  messages.push(
    messageBubble({
      side: "incoming",
      y,
      width: 450,
      height: 58,
      lines: ["What are you building now?"],
      delay: "1.64",
    }),
  );
  y += 84;

  for (const [index, repository] of repositories.entries()) {
    const bubble = repositoryBubble(repository, index, y, index === repositories.length - 1);
    messages.push(bubble.svg);
    y += bubble.height + 8;
  }

  const height = y + 48;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Aiden's live GitHub profile conversation</title>
  <desc id="desc">A dark iMessage-style conversation showing a Seoul forecast, today's date, and repositories pinned by seungwonme.</desc>
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
    .message-text { fill: #ffffff; font: 400 27px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; letter-spacing: -.3px; }
    .message-secondary { fill: #e1e1e1; font: 400 27px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; }
    .repo-title { fill: #ffffff; font: 650 22px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; letter-spacing: -.2px; }
    .repo-description { fill: #ffffff; font: 400 17px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; }
    .repo-meta { fill: #d7edff; font: 600 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; }
    .receipt { fill: #9a9a9a; font: 600 16px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Segoe UI", sans-serif; }
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
  <text x="970" y="${height - 20}" text-anchor="end" class="receipt">Read: ${escapeXml(seoulWeekday(now))}</text>
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
  assert.deepEqual(weatherDetails("clearsky_day"), {
    emoji: "☀",
    description: "clear sky",
  });
  assert.deepEqual(weatherDetails("heavyrainandthunder"), {
    emoji: "⛈",
    description: "thunderstorm",
  });
  assert.deepEqual(
    parseWeather({
      properties: {
        timeseries: [
          {
            data: {
              instant: {
                details: {
                  air_temperature: 23.6,
                  relative_humidity: 68.4,
                  wind_speed: 2.6,
                },
              },
              next_1_hours: { summary: { symbol_code: "partlycloudy_day" } },
            },
          },
        ],
      },
    }),
    {
      temperature: 24,
      humidity: 68,
      windSpeed: 3,
      emoji: "⛅",
      description: "partly cloudy",
    },
  );
  assert.throws(() => parseWeather({}), /unexpected response/);
  const svg = renderSvg({
    repositories: [
      {
        nameWithOwner: "seungwonme/test",
        description: "A test repository",
        stargazerCount: 1,
        primaryLanguage: { name: "JavaScript" },
      },
    ],
    weather: {
      temperature: 24,
      humidity: 68,
      windSpeed: 3,
      description: "clear sky",
      emoji: "☀",
    },
    now: new Date("2026-07-16T00:00:00Z"),
  });
  assert.match(svg, /seungwonme\/test/);
  assert.match(svg, /Read: Thursday/);
  console.log("Self-test passed.");
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  const [repositories, weather] = await Promise.all([
    fetchPinnedRepositories(process.env.GH_TOKEN),
    fetchWeather(),
  ]);
  const svg = renderSvg({ repositories, weather });
  await writeAtomically(OUTPUT_PATH, svg);
  console.log(`Updated ${OUTPUT_PATH} with ${repositories.length} pinned repositories.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
