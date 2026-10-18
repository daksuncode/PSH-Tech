# PSH-Tech

Peta **Peak Sun Hours (PSH)** Indonesia untuk perencanaan PLTS atap / PLTS surya.

- **Data radiasi** (dua sumber, bisa dibandingkan di aplikasi). PSH = kWh/m²/hari ÷ 1 kW/m²,
  jadi angka radiasi harian langsung sama dengan jam PSH.
  - [NASA POWER](https://power.larc.nasa.gov), `ALLSKY_SFC_SW_DWN`, rata-rata jangka panjang,
    grid 1° (±110 km).
  - [Global Solar Atlas 2.0](https://globalsolaratlas.info) (World Bank/ESMAP, data © 2019 Solargis,
    CC BY 4.0): GHI rata-rata harian ±280 m dan PVOUT (kWh/kWp/hari) ±1 km. GSA hanya
    menerbitkan nilai bulanan untuk PVOUT, jadi PSH bulanan GSA **diestimasi** sebagai
    GHI tahunan × (PVOUT bulan itu ÷ PVOUT tahunan).
- **Batas wilayah:** batas administrasi BPS (34 provinsi, 522 kabupaten/kota, 7.069 kecamatan)
  dari [OCHA HDX COD-AB](https://data.humdata.org/dataset/cod-ab-idn), diambil lewat salinan
  [geoBoundaries](https://www.geoboundaries.org) "gbHumanitarian". Lisensi CC BY 3.0 IGO.
- **Peta:** [MapLibre GL JS](https://maplibre.org) + basemap [OpenFreeMap](https://openfreemap.org)
  (data © OpenStreetMap). Semuanya open source dan tanpa API key.
- **Web:** React + Vite (TypeScript), di-deploy ke **Cloudflare Workers** (static assets).

> Kenapa bukan BMKG? API publik BMKG (`api.bmkg.go.id`) cuma menyediakan prakiraan cuaca
> 3 hari, tanpa data radiasi. Data lama penyinaran BMKG (dataonline.bmkg.go.id) cocok untuk
> **validasi** per stasiun, tapi bukan sumber utama peta.

## Fitur

- Peta PSH per **kabupaten/kota** atau per **kecamatan** (hanya daratan), bisa pilih rata-rata tahunan atau per bulan
- Dropdown **Sumber data**: NASA POWER, Global Solar Atlas, atau **Selisih (GSA − NASA)** dengan skala warna divergen
- Klik wilayah → nama, induk wilayah, nilai NASA/GSA/selisih, dan grafik 12 bulan kedua sumber berdampingan
- Kalkulator PLTS: produksi = PSH × kWp × performance ratio, plus estimasi kWp untuk kebutuhan kWh/bulan,
  dan pembanding produksi tahunan dari PVOUT GSA

## Menjalankan secara lokal

```bash
npm install
npm run dev          # http://localhost:5173
```

Data wilayah sudah ada di repo (`public/data/*.topo.json`), jadi langsung bisa dijalankan.

### Memperbarui data

```bash
npm run data:fetch     # grid NASA POWER -> data/psh-grid.json
npm run data:gsa       # unduh paket GIS Global Solar Atlas Indonesia (±330 MB) -> .cache/gsa/raster
npm run data:regions   # batas wilayah + rata-rata PSH -> public/data/kabupaten.topo.json, kecamatan.topo.json
```

- `data:fetch` mengambil data per kotak 10°×10° (batas API regional NASA POWER).
- `data:gsa` mengunduh GeoTIFF GSA (GHI, PVOUT tahunan + bulanan). File ini tidak di-commit.
  Kalau dilewati, `data:regions` tetap jalan tapi hanya menulis nilai NASA.
- `data:regions` mengunduh batas wilayah (disimpan di `.cache/`), menyederhanakan bentuknya,
  lalu menghitung PSH tiap wilayah sebagai rata-rata grid yang diinterpolasi bilinear di titik-titik
  sampel di dalam poligon. Induk wilayah (kecamatan → kabupaten → provinsi) dicocokkan secara spasial.
  Nilai GSA dihitung sebagai rata-rata piksel yang titik tengahnya ada di dalam poligon.
  Hasilnya TopoJSON (kecamatan ±5,7 MB, ±1,65 MB terkompresi).

Commit hasilnya supaya build di Cloudflare tidak perlu mengunduh apa pun.

> **Batas resolusi:** grid NASA POWER berukuran 1° (±110 km), jadi nilai kecamatan yang berdekatan
> sering mirip. Untuk perbedaan antar-kecamatan, pakai mode Global Solar Atlas (±280 m).
> Beberapa pulau sangat kecil (mis. Kepulauan Seribu) tidak tercakup raster GSA.

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
src/components/PshExplorer    state utama: level, sumber data, periode, panel
src/components/PshMap         peta MapLibre + layer wilayah
src/components/MonthlyChart   grafik PSH bulanan
src/components/Calculator     kalkulator PLTS
src/lib/psh.ts                tipe data wilayah, skala warna, pemuat TopoJSON
scripts/fetch-psh-grid.mjs    pengunduh grid NASA POWER
scripts/fetch-gsa.mjs         pengunduh raster Global Solar Atlas
scripts/build-regions.mjs     batas wilayah + agregasi PSH (NASA & GSA) per kabupaten/kecamatan
data/psh-grid.json            grid NASA POWER (input build)
public/data/*.topo.json       data wilayah yang dimuat aplikasi
wrangler.jsonc                konfigurasi Cloudflare
```

## Rencana berikutnya

- Pencarian nama kecamatan/kabupaten
- Validasi dengan data lama penyinaran stasiun BMKG
