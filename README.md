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
