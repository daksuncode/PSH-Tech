# PSH-Tech

Peta **Peak Sun Hours (PSH)** Indonesia untuk perencanaan PLTS atap / PLTS surya.

- **Data:** [NASA POWER](https://power.larc.nasa.gov), parameter `ALLSKY_SFC_SW_DWN`
  (radiasi matahari harian di permukaan, kWh/m²/hari). Karena PSH = kWh/m²/hari ÷ 1 kW/m²,
  angkanya langsung sama dengan jam PSH. Dipakai rata-rata jangka panjang (climatology).
- **Peta:** [MapLibre GL JS](https://maplibre.org) + basemap [OpenFreeMap](https://openfreemap.org)
  (data © OpenStreetMap). Semuanya open source dan tanpa API key.
- **Web:** React + Vite (TypeScript), di-deploy ke **Cloudflare Workers** (static assets).

> Kenapa bukan BMKG? API publik BMKG (`api.bmkg.go.id`) cuma menyediakan prakiraan cuaca
> 3 hari, tanpa data radiasi. Data lama penyinaran BMKG (dataonline.bmkg.go.id) cocok untuk
> **validasi** per stasiun, tapi bukan sumber utama peta.

## Fitur

- Layer grid PSH se-Indonesia, bisa pilih rata-rata tahunan atau per bulan
- Klik titik mana saja → PSH bulanan langsung dari API NASA POWER (kalau API gagal, pakai sel grid terdekat)
- Kalkulator PLTS: produksi = PSH × kWp × performance ratio, plus estimasi kWp untuk kebutuhan kWh/bulan

## Menjalankan secara lokal

```bash
npm install
npm run data:fetch   # unduh grid NASA POWER -> public/data/psh-grid.json (sekali saja)
npm run dev          # http://localhost:5173
```

`data:fetch` mengambil data per kotak 10°×10° (batas API regional NASA POWER) lalu
menyimpan grid ringkas. **Commit file `public/data/psh-grid.json`** supaya build di
Cloudflare tidak perlu memanggil API NASA lagi.

## Deploy ke Cloudflare

`vite build` menghasilkan situs statis di `dist/`, lalu `wrangler.jsonc` menyajikan folder itu
sebagai static assets Worker (mode single-page application). Tidak ada kode server.

### Opsi A: hubungkan repo GitHub (disarankan)

1. Dashboard Cloudflare → **Workers & Pages** → **Create** → **Import a repository** → pilih repo ini.
2. Isi pengaturan build:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
3. Simpan. Setiap push ke branch production akan otomatis di-deploy ke
   `psh-tech.<akun>.workers.dev` (domain sendiri bisa ditambahkan di tab *Settings → Domains & Routes*).

### Opsi B: deploy dari laptop

```bash
npx wrangler login
npm run deploy       # vite build && wrangler deploy
```

`npm run preview` menyajikan hasil build secara lokal; `npm run cf:preview` menjalankannya dengan runtime Cloudflare (`wrangler dev`).

## Struktur

```
index.html                    entry HTML Vite
src/main.tsx                  bootstrap React
src/components/PshExplorer    state utama: periode, titik terpilih, panel
src/components/PshMap         peta MapLibre + layer grid
src/components/MonthlyChart   grafik PSH bulanan
src/components/Calculator     kalkulator PLTS
src/lib/psh.ts                tipe data, skala warna, akses NASA POWER
scripts/fetch-psh-grid.mjs    pengunduh grid NASA POWER
wrangler.jsonc                konfigurasi Cloudflare
```

## Rencana berikutnya

- Masking laut (sekarang grid juga menutupi lautan)
- Rata-rata PSH per provinsi/kabupaten pakai batas wilayah [geoBoundaries](https://www.geoboundaries.org) (ADM1/ADM2)
- Pencarian lokasi (geocoding Nominatim/OSM)
- Validasi dengan data lama penyinaran stasiun BMKG
