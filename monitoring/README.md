# Monitoring API dengan Grafana

Worker (`worker/`) menulis satu baris metrik per request API ke **Workers Analytics Engine**
(dataset `psh_api_metrics`). Grafana membacanya lewat SQL API Cloudflare, memakai plugin
**Altinity ClickHouse** sesuai panduan resmi Cloudflare.

```
browser → Worker /api/* → Claude API
              │
              └─ writeDataPoint() → Analytics Engine ← SQL API ← Grafana (dashboard ini)
```

## Isi dashboard "PSH-Tech API"

| Bagian | Panel |
|---|---|
| Ringkasan | jumlah request, request AI, error rate, latency p95 chat, total token, estimasi biaya |
| Lalu lintas & error | request per route, outcome (ok / client_error / rate_limited / upstream_error / refusal / …) |
| Latensi | p95 dan p50 per route, waktu sampai teks pertama muncul |
| Token & biaya | token input/output/cache per interval, estimasi biaya per route |
| Asisten AI | pemanggilan tool, error per jenis, model & fallback, negara, stop reason, data center |

Skema kolom (`blob1..8`, `double1..13`) ada di `worker/src/metrics.ts`. Test
`worker/test/dashboard.test.ts` memastikan query dashboard hanya memakai kolom yang benar-benar ditulis.

## Menjalankan Grafana (docker compose)

Data metrik hanya ada setelah Worker **di-deploy** ke Cloudflare (`npm run deploy`).
`wrangler dev` di laptop tidak menulis ke Analytics Engine; metriknya hanya muncul di log terminal.

1. **Account ID**: dashboard Cloudflare → Workers & Pages → Account ID di panel kanan.
2. **API token**: My Profile → API Tokens → Create Token → *Custom token*,
   permission **Account → Account Analytics → Read**, lalu simpan tokennya.
3. Isi konfigurasi dan jalankan:

   ```bash
   cd monitoring
   cp .env.example .env    # isi CF_ACCOUNT_ID, CF_API_TOKEN, GRAFANA_ADMIN_PASSWORD
   docker compose up -d
   ```

4. Buka http://localhost:3000, login `admin` dengan password dari `.env`. Dashboard
   **PSH-Tech → PSH-Tech API** sudah terpasang.

Cek koneksi ke Analytics Engine tanpa Grafana:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -d "SELECT blob1 AS route, SUM(_sample_interval) AS requests FROM psh_api_metrics WHERE timestamp > NOW() - INTERVAL '1' DAY GROUP BY route"
```

## Grafana Cloud (tanpa server sendiri)

1. Di Grafana Cloud, pasang plugin **Altinity plugin for ClickHouse** dari katalog.
2. Tambah data source dengan plugin itu:
   - URL: `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql`
   - semua opsi auth dimatikan
   - Custom HTTP header: `Authorization` = `Bearer <API_TOKEN>`
3. Import `grafana/dashboards/psh-api.json`. Dashboard ini menunjuk data source ber-uid
   `cf-analytics-engine`; ganti uid itu dengan uid data source kamu sebelum import, misalnya
   `sed 's/cf-analytics-engine/UID_KAMU/g' psh-api.json > psh-api-cloud.json`.

## Catatan

- Di volume tinggi Analytics Engine menyimpan data secara sampling. Semua query sudah
  memperhitungkannya (`SUM(_sample_interval)`, `quantileExactWeighted(...)(…, _sample_interval)`).
- Biaya di dashboard adalah **estimasi** dari harga daftar per model (`worker/src/claude.ts`).
  Tagihan resmi ada di Anthropic Console.
- Untuk request streaming (chat, explain), status HTTP tercatat 200 karena stream sudah
  dimulai; kegagalan setelahnya terlihat di kolom **outcome**.
- Ide alert di Grafana: error rate AI > 5% selama 10 menit, atau estimasi biaya per hari
  melewati batas anggaranmu.
