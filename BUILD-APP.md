# FPV KAMIKAZE jako aplikace (na stažení)

Hra funguje offline. Máš tři možnosti, od nejjednodušší po „opravdový .exe“.

---

## 1) Nejjednodušší: dvojklik na `index.html`
Hra se otevře v prohlížeči. Funguje i bez internetu (vše je lokální).
Nevýhoda: je vidět adresní řádek a záložky.

## 2) Vypadá jako aplikace: `Start.bat`
Dvojklik na **`Start.bat`** otevře hru v Chrome/Edge v režimu **app okna**
(bez adresního řádku, bez záložek, na celou obrazovku). Funguje offline.
Když Chrome ani Edge nemáš, otevře se klasické okno prohlížeče.

> Pokud Windows zobrazí varování SmartScreen, klikni na „Další informace → Přesto spustit“.
> Je to jen `.bat`, který spouští tvůj vlastní prohlížeč.

## 3) PWA — instalace z prohlížeče (Chrome / Edge)
1. Spusť lokální server: v PowerShellu v této složce `./serve.ps1`
   (nebo jakýkoli jiný statický server na `http://localhost`).
2. Otevři `http://127.0.0.1:8137/`.
3. V adresním řádku klikni na ikonu **„Nainstalovat aplikaci“** (nebo menu → Aplikace → Nainstalovat).
4. Hra se přidá do Start menu a otevře se jako samostatné okno.
   Po prvním načtení funguje i offline (service worker `sw.js`).

## 4) Opravdový `.exe` (Electron)
Potřebuješ **Node.js** (https://nodejs.org). Pak v této složce:

```bat
npm install
npm start          :: spustí hru v Electron okně
npm run dist       :: vytvoří portable .exe ve složce dist/
```

Výsledek `dist/FPV Kamikaze 1.0.0.exe` je jeden soubor, který můžeš poslat dál.
Uvnitř je celá hra, funguje offline, bez instalace.

Soubory pro Electron: `package.json`, `main.js`.
Hru načítá přímo z `index.html`, takže žádný server není potřeba.

---

### Co je potřeba zachovat
Když složku někam kopíruješ/rozesíláš, zkopíruj **celou složku** včetně:
`index.html`, `css/`, `js/`, `lib/`, `manifest.webmanifest`, `icon.svg`, `sw.js`.
