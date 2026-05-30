# RZG Premium (Astro + Sveltia CMS)

Bu proje Astro tabanlı statik sitedir ve Sveltia CMS ile **kod yazmadan** düzenlenebilir.

## Geliştirme

```bash
npm install
npm run dev
```

Site adresi:

- `http://localhost:8080`

CMS adresi:

- `http://localhost:8080/cms/`

## İçerik Yapısı

- Genel ayarlar: `src/data/site.json`
- Sayfalar: `src/data/pages/*.json`

Sveltia panelinde bu dosyalar form alanları olarak açılır:

- Meta başlık/açıklama
- Hero başlık/açıklama
- Sayfa içeriği (Markdown editörü)

## Build

```bash
npm run build
```

Çıktı klasörü:

- `dist/`

## Sveltia "Work with Local Repository" Notu (Brave)

Brave'de bu buton pasif görünüyorsa:

1. Adrese gidin: `brave://flags/#file-system-access-api`
2. **File System Access API** seçeneğini **Enabled** yapın.
3. Brave'i yeniden başlatın.
4. Admin sayfasını tekrar açın.

## Cloudflare Cron Worker (GIB Duyuru)

Bu repo içinde, GIB duyuru endpointini her gün otomatik çağıran ayrı bir Worker şablonu bulunur:

- Kod: `cloudflare/duyuru-worker/src/index.ts`
- Konfig: `cloudflare/duyuru-worker/wrangler.jsonc`

Worker akışı:

1. GIB API'den son 50 duyuruyu çeker.
2. Site formatına dönüştürür.
3. `src/data/duyurular.json` dosyasını GitHub API ile günceller.
4. Repo'ya commit düştüğü için Cloudflare Pages yeni deploy alır.

### Zamanlama

Cloudflare cron UTC ile çalışır. Türkiye saati ile `00:15` için cron:

- `15 21 * * *` (UTC)

### Local test

```bash
npx wrangler dev --config cloudflare/duyuru-worker/wrangler.jsonc --test-scheduled
curl "http://127.0.0.1:8787/__scheduled?cron=15+21+*+*+*"
```

Manual tetikleme:

```bash
curl -X POST "http://127.0.0.1:8787/run"
```

Sadece çekim testi (GitHub'a yazmadan):

```bash
curl -X POST "http://127.0.0.1:8787/run?dryRun=1"
```

Site formatında çıktı önizleme:

```bash
curl "http://127.0.0.1:8787/duyurular.json"
```

Eğer `CRON_SECRET` tanımlarsanız:

```bash
curl -X POST "http://127.0.0.1:8787/run" -H "x-cron-secret: <secret>"
```

### Deploy

```bash
npx wrangler deploy --config cloudflare/duyuru-worker/wrangler.jsonc
```

Opsiyonel güvenlik anahtarı:

```bash
npx wrangler secret put CRON_SECRET --config cloudflare/duyuru-worker/wrangler.jsonc
```

GitHub'a yazabilmesi için zorunlu secret:

```bash
npx wrangler secret put GITHUB_TOKEN --config cloudflare/duyuru-worker/wrangler.jsonc
```

`GITHUB_TOKEN` yetkisi:

- Repository contents: Read and write

İsteğe bağlı committer bilgisi:

```bash
# wrangler.jsonc -> vars içine eklenebilir
"COMMITTER_NAME": "RZG Bot",
"COMMITTER_EMAIL": "bot@rzgymm.com.tr"
```
