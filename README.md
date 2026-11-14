# FPV KAMIKAZE — simulátor jednorázového průzkumného dronu

Browserová 3D hra: začínáš jako **pěšák** na základně s puškou a raketometem
(s viditelnými 3D modely zbraní), z beden (i v zákopech) sbíráš až **3 FPV drony**
do batohu a s nimi ničíš cíle na mapě náletem (jeden dron = jedna nálož).
Grafika: low-poly, Three.js.

## Hrát online

**https://martalusek-hub.github.io/fpv-kamikaze/** — hra běží přímo v prohlížeči
(GitHub Pages) a jde nainstalovat jako aplikaci. Po prvním načtení funguje i offline.

Zdrojový kód: https://github.com/martalusek-hub/fpv-kamikaze

## Spuštění lokálně

**Dvojklik na `index.html`** — hra běží i offline (Three.js je lokálně v `lib/`).

Chceš to jako **aplikaci** (bez adresního řádku, na stažení)? Viz `BUILD-APP.md`:

- **`Start.bat`** — otevře hru v Chrome/Edge jako samostatné app okno (offline).
- **PWA** — přes lokální server ji můžeš nainstalovat z prohlížeče.
- **`.exe`** — Electron scaffold (`package.json` + `main.js`), stačí `npm install && npm run dist`.

Případně přes lokální server: `powershell -ExecutionPolicy Bypass -File serve.ps1`
→ otevři `http://127.0.0.1:8137/`.

## Bedny s drony

- U základny jsou 3 bedny (jedna od každého typu) a další jsou rozeseté po mapě.
- **V zákopech jsou vždy všechny tři typy dronů** (kamikaze, recon, bomber).
- Sebraná bedna v zákopu se **vrátí za 10 sekund**, ostatní bedny za 75 sekund.

## Ovládání — PĚŠÁK

| vstup | funkce |
|---|---|
| WASD | pohyb |
| MYŠ | rozhlížení (klik do obrazu = zámek kurzoru; bez zámku stačí hýbat myší, u okrajů obrazu se otáčíš plynule) |
| LMB | palba puškou |
| RMB | raketomet (5 raket, ničí tanky a vozidla) |
| 1 / 2 | puška / raketomet |
| R | přebít pušku |
| E | vzít dron z bedny (bedny jsou i v zákopech; batoh = 3 drony) |
| Q / kolečko myši | výběr dronu z batohu (Z = zpět) |
| G | vypustit vybraný dron z ruky (přepne do FPV) |
| MEZERNÍK | skok, SHIFT = sprint |
| ESC | pauza |

## Ovládání — DRON

| vstup | funkce |
|---|---|
| šipky ↑ ↓ | výškovka (dopředu = ponor, přitáhnout = nahoru) |
| šipky ← → | křidélka / náklon |
| A / D | směrovka (yaw) |
| W / S | plyn (drží se jako páčka bez pružiny) |
| MEZERNÍK | ARM / DISARM (v acro nejdřív stáhni plyn) |
| R | odvolat dron — zpět k pěšákovi (dron se spotřebuje) |
| C | kamera FPV / TPS |
| O / T / B | orbit / termokamera / pumy (podle typu dronu) |
| N / F / M | minimapa / značky cílů / ztlumit |
| ESC | pauza |

### Gamepad (Mode 2)
Levá páčka = plyn + směrovka, pravá = výškovka + křidélka.
A/Cross = ARM, B/Circle = respawn (u pěšáka přebití), Start = pauza,
R2 = palba, L2 = raketa, Y = vzít bednu, X = vypustit dron.

### RC rádio (USB Joystick)
1. Vysílač přepni do režimu **USB Joystick** a připoj k PC (rádio se v prohlížeči
   objeví přes Gamepad API).
2. V **NASTAVENÍ → GAMEPAD / RC RÁDIO** vyber přednastavení **RC RÁDIO AETR**
   (osa 1 křidélka, 2 výškovka, 3 plyn, 4 směrovka).
3. Podle živého náhledu přemapuj kanály, případně zaškrtni OBRÁTIT a nastav mrtvou zónu.
4. ARM = tlačítko A (default), respawn = B.

Když rádio/gamepad nic nedělá, hra automaticky spadne na klávesnici (a naopak).

## Pěšák, zdraví a bedny
- **100 HP**, po 7 s bez zásahu se zdraví regeneruje (5 HP/s), smrt = respawn na základně.
- **Bedny** (žluté čtverce na minimapě): 3 na základně (od každého typu dronu jedna)
  + 9 rozmístěných po mapě + **12 v zákopech** (v každém zákopu jsou všechny tři typy).
  Sebráním získáš dron do ruky, bedna zmizí a obnoví se — **v zákopu za 10 s**, jinde za 75 s.
- Puška zabíjí pěchotu, o pancíř se odráží — na tanky/BTR použij **raketomet**
  nebo dron. Raketa má dostřel i plošný zásah (pozor na sebe v okolí 7,5 m).

## Režimy letu (NASTAVENÍ → LET)
- **ACRO** — plné rate řízení jako racer; páčka plynu přímo určuje tah (dole = 0 %).
  Jediný způsob skutečného rychlého ponoru — stáhni plyn a nakloň nos.
- **ANGLE** — samovýrovna; střed páčky = držení výšky, horní/dolní poloha = stoupání/klesání.

## Typy dronů
| dron | trup | výbava |
|---|---|---|
| KAMIKAZE | 3 zásahy | nálož, rychlý, obratný |
| RECON | 4 zásahy | termokamera, orbit (kroužení), označování cílů +15 b. |
| BOMBER | 6 zásahů | 4 pumy (B), termokamera, orbit |

## Cíle (16, celkem 1720 b. + bonus za pěchotu)
4× tank (hlídkují kolem základny), 3× BTR (jedno vozí zásoby po silnici),
2× muniční truck, palivová základna (řetězová exploze), radar, SAM, AA kanón,
velitelství, vrtulník, muniční sklad (řetězová exploze).

## Nepřátelská pěchota
- Hlídky se pohybují **jen v okolí svého postavení** (9–16 m), zastavují se, míří
  a střílejí na pěšáka (do 400 m) i na dron (do 620 m); palbu blokují překážky.
- Zásah pěšáka ubírá 7–13 HP; dron vydrží 3 zásahy (RECON 4, BOMBER 6).
- Pěchotu lze zabít puškou, raketou, výbuchem i náletem — každý **+20 b.**

## Ostatní
- baterie dronu vydrží ~2 min plného výkonu / ~5 min visení
- signál VDO slábne s odstupem od tábora (šum na obrazu, ~560 m+)
- skóre + bonus za přesnost a čas → hodnocení S/A/B/C
- nastavení se ukládá do `localStorage` prohlížeče

## Struktura
```
index.html        — HTML + obrazovky menu
css/style.css     — styl UI
lib/three.min.js  — Three.js r128 (lokální, offline)
js/util.js        — matematika, šum, nastavení
js/audio.js       — procedurální zvuk (WebAudio)
js/input.js       — klávesnice + gamepad/RC rádio
js/drone.js       — fyzika dronu (acro/angle)
js/effects.js     — částice, výbuchy, kouř
js/world.js       — terén, základna, cíle, bedny, AI pěchoty
js/player.js      — pěšák (pohyb, puška, raketomet, zdraví)
js/hud.js         — OSD/HUD (canvas 2D)
js/game.js        — herní smyčka, mise, přepínání pěšák/dron, UI
serve.ps1         — volitelný lokální HTTP server

manifest.webmanifest, sw.js, icon.svg — PWA (instalace z prohlížeče, offline)
Start.bat         — spustí hru jako samostatné app okno (Chrome/Edge)
package.json, main.js — Electron scaffold pro .exe (viz BUILD-APP.md)
```
