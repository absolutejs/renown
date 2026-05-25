// ASCII spectacle — big block text + animated scenes for the rarest moments (phase 4).
// A 5-row block font renders any word/number huge; scenes (trophy, fireworks, treasure)
// animate frame-by-frame; everything can be painted with truecolor gradients or a
// scrolling rainbow. Played full-screen on a 99 / legendary unlock (and on `renown demo`).
import { B, R, fg, gradient, rainbow, type RGB } from "./shiny.ts";

const G = "#"; // fill marker in the font source; rendered as a solid block
const FONT_H = 5;
// 5-row, 5-wide block font (uppercase, digits, a few symbols)
const FONT: Record<string, string[]> = {
  " ": ["     ", "     ", "     ", "     ", "     "],
  "!": ["  #  ", "  #  ", "  #  ", "     ", "  #  "],
  "-": ["     ", "     ", " ### ", "     ", "     "],
  ".": ["     ", "     ", "     ", "     ", "  #  "],
  "0": [" ### ", "#  ##", "# # #", "##  #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "  ## ", " #   ", "#####"],
  "3": ["#### ", "    #", " ### ", "    #", "#### "],
  "4": ["#  # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "#### "],
  "6": [" ### ", "#    ", "#### ", "#   #", " ### "],
  "7": ["#####", "    #", "   # ", "  #  ", "  #  "],
  "8": [" ### ", "#   #", " ### ", "#   #", " ### "],
  "9": [" ### ", "#   #", " ####", "    #", " ### "],
  A: [" ### ", "#   #", "#####", "#   #", "#   #"],
  B: ["#### ", "#   #", "#### ", "#   #", "#### "],
  C: [" ####", "#    ", "#    ", "#    ", " ####"],
  D: ["#### ", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#### ", "#    ", "#####"],
  F: ["#####", "#    ", "#### ", "#    ", "#    "],
  G: [" ####", "#    ", "#  ##", "#   #", " ####"],
  H: ["#   #", "#   #", "#####", "#   #", "#   #"],
  I: ["#####", "  #  ", "  #  ", "  #  ", "#####"],
  J: ["#####", "   # ", "   # ", "#  # ", " ##  "],
  K: ["#   #", "#  # ", "###  ", "#  # ", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "#   #", "#   #"],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", " ### "],
  P: ["#### ", "#   #", "#### ", "#    ", "#    "],
  Q: [" ### ", "#   #", "# # #", "#  # ", " ## #"],
  R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
  S: [" ####", "#    ", " ### ", "    #", "#### "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", " ### "],
  V: ["#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "# # #", "## ##", "#   #"],
  X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
  Y: ["#   #", " # # ", "  #  ", "  #  ", "  #  "],
  Z: ["#####", "   # ", "  #  ", " #   ", "#####"]
};

// big block text as a 5-line string (unpainted; # → █)
export const figText = (text: string) => {
  const glyphs = [...text.toUpperCase()].map((ch) => FONT[ch] ?? FONT[" "]);
  const rows: string[] = [];
  for (let r = 0; r < FONT_H; r++) rows.push(glyphs.map((g) => g[r]).join(" ").replaceAll(G, "█"));
  return rows.join("\n");
};

// paint every line of a block with the same rainbow phase → vertical rainbow stripes
export const rainbowBlock = (art: string, phase = 0, spread = 0.04) =>
  art.split("\n").map((line) => rainbow(line, phase, spread)).join("\n");
export const gradientBlock = (art: string, a: RGB, b: RGB) =>
  art.split("\n").map((line) => gradient(line, a, b)).join("\n");
export const solid = (art: string, c: RGB) =>
  art.split("\n").map((line) => fg(...c) + line + R).join("\n");

// center a block in the terminal width
export const center = (art: string, width = process.stdout.columns || 80) =>
  art.split("\n").map((line) => " ".repeat(Math.max(0, Math.floor((width - [...line.replace(/\x1b\[[0-9;]*m/g, "")].length) / 2))) + line).join("\n");

// ---- scenes ----
export const TROPHY = `        ___________
       '._==_==_=_.'
       .-\\:      /-.
      | (|:.     |) |
       '-|:.     |-'
         \\::.    /
          '::. .'
            ) (
          _.' '._
         '"""""""'`;

const FIRE = [
  `
        .
        |
        |
       .'.
`,
  `
       \\ . /
      - ( ) -
       / ' \\
        \\|/
`,
  `
    .  \\ | /  .
   --=  ( + )  =--
    '  / | \\  '
       \\ | /
`,
  `
   *   .  *  .   *
  .  \\  .|.  /  .
 --- == ( O ) == ---
  .  /  '|'  \\  .
   *   '  *  '   *
`,
  `
    .    *    .
       .   .
   *     .     *
      .     .
    *    .    *
`
];
export const fireworks = (loops = 3) => Array.from({ length: loops }, () => FIRE).flat();

const CHEST = [
  `      ________
     /        \\
    /__________\\
    |  ______  |
    | |      | |
    |_|______|_|`,
  `       \\  |  /
      ___\\_|_/__
     /  *  ✦  * \\
    /__★__◆__✦__\\
    |  $  ◆  $  |
    |___________|`,
  `    ✦   ✺   ✦   ✺
   \\   .  ✦  .   /
    \\_*_★_◆_✦_*_/
    | 💎 ◆ ✦ 💎 |
    |___________|`
];
export const chestOpen = () => CHEST;

const SPARKLE = [
  `  ·   ✦   ·   ✦  `,
  `  ✦   ·   ✦   ·  `,
  `   ✦   ✺   ✦   ·  `,
  `  ·   ✦   ·   ✦  `
];
export const sparkleLine = () => SPARKLE;

// ---- the animator ----
type PlayOptions = { delay?: number; clear?: boolean };
const HIDE = "\x1b[?25l", SHOW = "\x1b[?25h", CLEAR = "\x1b[2J\x1b[H";
export const play = async (frames: string[], { delay = 90, clear = true }: PlayOptions = {}) => {
  process.stdout.write(HIDE);
  for (const frame of frames) {
    if (clear) process.stdout.write(CLEAR);
    process.stdout.write("\n" + frame + "\n");
    await Bun.sleep(delay);
  }
  process.stdout.write(SHOW);
};

const rainbowCycle = (art: string, frames: number, spread = 0.04) =>
  Array.from({ length: frames }, (_, i) => center(rainbowBlock(art, i / frames, spread)));

// ---- composite celebrations (return frame arrays) ----
export const levelUpFrames = (name: string, level: number) => {
  const banner = `${figText("LEVEL UP")}\n\n${figText(`${name} ${level}`)}`;
  return [...rainbowCycle(banner, 10), ...fireworks(1).map((f) => center(solid(f, [255, 220, 90])))];
};
export const masteryFrames = (name: string) => {
  const banner = `${figText("MASTERY")}\n\n${figText(`${name} 99`)}`;
  return [
    ...fireworks(1).map((f) => center(solid(f, [255, 80, 80]))),
    ...rainbowCycle(banner, 18, 0.03),
    ...fireworks(2).map((f) => center(rainbowBlock(f, Math.random())))
  ];
};
export const dropFrames = (item: string, rarityColor: RGB) => {
  const open = chestOpen().map((c, i) => center((i === 0 ? solid(c, [150, 110, 70]) : rainbowBlock(c, i / 3))));
  const label = center(gradientBlock(figText(item), rarityColor, [255, 255, 255]));
  return [...open, ...open, label, ...sparkleLine().map((s) => center(solid(s, rarityColor))), label];
};
export const trophyFrames = (loops = 12) =>
  Array.from({ length: loops }, (_, i) => center(rainbowBlock(TROPHY, i / loops, 0.05)));

// a generic epic burst for any rare unlock (emoji are dropped by the font)
export const epicFrames = (label: string) => [
  ...fireworks(1).map((f) => center(rainbowBlock(f, Math.random()))),
  ...rainbowCycle(figText(label.replace(/[^a-z0-9 !.-]/gi, " ").trim() || "RENOWN"), 16, 0.035),
  ...fireworks(1).map((f) => center(solid(f, [255, 220, 90])))
];

// the on-demand showcase (`renown gallery` / `bun run demo`)
export const runGallery = async () => {
  await play(rainbowCycle(figText("RENOWN"), 16, 0.05), { delay: 70 });
  await play(levelUpFrames("RUST", 50), { delay: 110 });
  await play(trophyFrames(16), { delay: 80 });
  await play(masteryFrames("SHIPPING"), { delay: 100 });
  await play(dropFrames("RARE DROP", [120, 220, 255]), { delay: 170 });
  await play(fireworks(2).map((f) => center(rainbowBlock(f, Math.random()))), { delay: 110 });
  process.stdout.write(CLEAR + "\n" + center(rainbowBlock(figText("GG"), 0.3, 0.06)) + "\n\n" + SHOW);
};
