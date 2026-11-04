// Gera os icones do programa (assets/icon.png, assets/tray*.ico e build/icon.ico, o do instalador e do .exe)
// a partir do desenho abaixo.
// Rodar: node tools/icons.js  (precisa do Playwright com Chromium e do Python com PIL)
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "assets");
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "cp-icons-"));
// desenho proprio: quadrado arredondado azul (cor do Discord) com um balao de conversa branco
const logo = (dot) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="18" fill="#5865f2"/>
  <path d="M14 17a5 5 0 0 1 5-5h26a5 5 0 0 1 5 5v18a5 5 0 0 1-5 5H29l-10 8v-8a5 5 0 0 1-5-5z" fill="#fff"/>
  <g fill="#5865f2"><circle cx="23" cy="26" r="3"/><circle cx="32" cy="26" r="3"/><circle cx="41" cy="26" r="3"/></g>
  ${dot ? '<circle cx="50" cy="50" r="15" fill="#121214"/><circle cx="50" cy="50" r="11" fill="#d22d39"/>' : ""}
</svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });
  const shot = async (svg, size, file) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: file, omitBackground: true });
  };
  for (const s of [16, 20, 24, 32, 40, 48, 64, 128, 256, 512]) {
    await shot(logo(false), s, path.join(TMP, `i${s}.png`));
    if (s <= 64) await shot(logo(true), s, path.join(TMP, `d${s}.png`));
  }
  await b.close();
  fs.copyFileSync(path.join(TMP, "i512.png"), path.join(OUT, "icon.png"));
  fs.copyFileSync(path.join(TMP, "i32.png"), path.join(OUT, "tray.png"));
  fs.copyFileSync(path.join(TMP, "d32.png"), path.join(OUT, "tray-unread.png"));
  const py = `
import sys
from PIL import Image
tmp, out = sys.argv[1], sys.argv[2]
def ico(prefix, sizes, name):
    imgs = [Image.open(f"{tmp}/{prefix}{s}.png").convert("RGBA") for s in sizes]
    big = imgs[-1]
    big.save(f"{out}/{name}", format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[:-1], bitmap_format="bmp")
ico("i", [16, 20, 24, 32, 40, 48, 64, 128, 256], "../build/icon.ico")
ico("i", [16, 20, 24, 32, 40, 48], "tray.ico")
ico("d", [16, 20, 24, 32, 40, 48], "tray-unread.ico")
`;
  execFileSync("python3", ["-I", "-c", py, TMP, OUT], { stdio: "inherit" });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("icones prontos em", OUT);
})();
