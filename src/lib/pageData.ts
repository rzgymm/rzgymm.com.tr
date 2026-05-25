import home from "../data/pages/home.json";
import kurumsal from "../data/pages/kurumsal.json";
import tamTasdik from "../data/pages/tam-tasdik-hizmetleri.json";
import kdv from "../data/pages/muhasebe-hizmeti.json";
import denetim from "../data/pages/denetim-ve-inceleme-danismanligi.json";
import vergi from "../data/pages/vergi-hizmetleri.json";
import tesvik from "../data/pages/tesvik-ve-yardimlar.json";
import iletisim from "../data/pages/iletisim.json";
import duyurular from "../data/pages/duyurular.json";
import haberler from "../data/pages/haberler.json";

export type PageData = {
  path: string;
  menuLabel: string;
  metaTitle: string;
  metaDescription: string;
  heroBadge: string;
  heroTitle: string;
  heroDescription: string;
  heroImage: string;
  body: string;
};

export const pages: PageData[] = [
  home,
  kurumsal,
  tamTasdik,
  kdv,
  denetim,
  vergi,
  tesvik,
  iletisim,
  duyurular,
  haberler,
];

export const pathToPage = new Map(pages.map((page) => [page.path, page]));
