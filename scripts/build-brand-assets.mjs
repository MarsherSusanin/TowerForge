import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = path.join(root, "assets", "brand");
const heroPath = path.join(brandDir, "towerforge-hero-art.png");
const markPath = path.join(brandDir, "towerforge-mark.svg");
const iconPath = path.join(brandDir, "towerforge-app-icon.svg");

await mkdir(brandDir, { recursive: true });

const [hero, mark, icon] = await Promise.all([
  readFile(heroPath),
  readFile(markPath),
  readFile(iconPath),
]);

const heroUrl = `data:image/png;base64,${hero.toString("base64")}`;
const markUrl = `data:image/svg+xml;base64,${mark.toString("base64")}`;
const iconUrl = `data:image/svg+xml;base64,${icon.toString("base64")}`;
const browser = await chromium.launch({ headless: true });

async function renderBanner({ width, height, output, social = false, language = "ru" }) {
  const copy = language === "ru"
    ? {
        descriptor: "КОНСТРУКТОР ИГР",
        tagline: "Создавайте tower-defense игры.<br>Визуально, детерминированно, с ИИ.",
        studio: "ОТКРЫТЫЙ ПРОЕКТ LINDFORGE STUDIOS",
      }
    : {
        descriptor: "GAME CONSTRUCTOR",
        tagline: "Build tower-defense games.<br>Visually, deterministically, with AI.",
        studio: "AN OPEN-SOURCE TOOL BY LINDFORGE STUDIOS",
      };
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html>
    <html><head><style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        color: #e8e8e8;
        background: #111111 url("${heroUrl}") center / cover no-repeat;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      }
      .shade {
        position: absolute; inset: 0;
        background: linear-gradient(90deg, rgba(10, 12, 10, .98) 0%, rgba(10, 12, 10, .92) 32%, rgba(10, 12, 10, .26) 58%, rgba(10, 12, 10, .04) 100%);
      }
      .content {
        position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center;
        width: ${social ? "58%" : "52%"}; padding: ${social ? "72px" : "86px"};
      }
      .brand { display: flex; align-items: center; gap: ${social ? "24px" : "28px"}; }
      .mark { width: ${social ? "96px" : "112px"}; height: ${social ? "96px" : "112px"}; }
      h1 { margin: 0; font-size: ${social ? "68px" : "78px"}; line-height: .94; font-weight: 780; letter-spacing: 0; }
      .descriptor { margin: 16px 0 0 ${social ? "120px" : "140px"}; color: #7eb87e; font-size: ${social ? "13px" : "15px"}; font-weight: 750; letter-spacing: 4px; text-transform: uppercase; }
      .rule { width: 64px; height: 4px; margin: ${social ? "38px" : "44px"} 0 24px; background: #e8a44a; }
      .tagline { max-width: 620px; margin: 0; font-size: ${social ? "25px" : "29px"}; line-height: 1.35; font-weight: 510; color: #d6dcd6; letter-spacing: 0; }
      .studio { margin-top: ${social ? "34px" : "40px"}; color: #8e998f; font-size: 14px; font-weight: 650; letter-spacing: .8px; }
      .edge { position: absolute; inset: 18px; border: 1px solid rgba(126, 184, 126, .18); pointer-events: none; }
    </style></head><body>
      <div class="shade"></div>
      <main class="content">
        <div class="brand"><img class="mark" src="${markUrl}" alt=""><h1>TowerForge</h1></div>
        <div class="descriptor">${copy.descriptor}</div>
        <div class="rule"></div>
        <p class="tagline">${copy.tagline}</p>
        <div class="studio">${copy.studio}</div>
      </main>
      <div class="edge"></div>
    </body></html>`);
  await page.screenshot({ path: path.join(brandDir, output), type: "png" });
  await page.close();
}

async function renderIcon() {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}img{display:block;width:1024px;height:1024px}</style><img src="${iconUrl}" alt="">`);
  await page.screenshot({
    path: path.join(brandDir, "towerforge-app-icon.png"),
    type: "png",
    omitBackground: true,
  });
  await page.close();
}

try {
  await renderBanner({ width: 1600, height: 640, output: "towerforge-readme-banner.png" });
  await renderBanner({ width: 1280, height: 640, output: "towerforge-social-preview.png", social: true });
  await renderBanner({ width: 1600, height: 640, output: "towerforge-readme-banner-en.png", language: "en" });
  await renderBanner({ width: 1280, height: 640, output: "towerforge-social-preview-en.png", social: true, language: "en" });
  await renderIcon();
  console.log(`Brand assets written to ${pathToFileURL(brandDir).href}`);
} finally {
  await browser.close();
}
