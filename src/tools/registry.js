export const SITE_ORIGIN = "https://redaktix.com";

export const TOOLS = Object.freeze([
  tool({
    slug: "hide-api-key",
    lang: "en",
    title: "Hide an API key in a screenshot",
    h1: "Hide an API key in a screenshot",
    keyword: "hide api key in screenshot",
    presetProfile: "global",
    activeDetectors: ["api_token"],
    introText: "Paste a bug report or dashboard capture and Redaktix highlights API keys, JWTs, and high-entropy secrets on this device. It also catches card numbers, IBAN, TCKN and VKN. Ordinary log IDs stay out of the suggestion list. Nothing in the image is uploaded.",
    exampleCodeOrImage: "Authorization: sk_live_51H7xExampleSecret\nRequest id: req_2024_8841",
    faqList: [
      { question: "Does this page upload the screenshot?", answer: "No. OCR runs in WebAssembly in this browser. The image pixels are not placed in a network request body." },
      { question: "Will a normal request id be blacked out?", answer: "Labels such as req_ and short log identifiers are not treated as API keys. Explicit tokens and high-entropy secrets are." },
    ],
    relatedSlugs: ["hide-jwt-token", "blur-email"],
  }),
  tool({
    slug: "blur-email",
    lang: "en",
    title: "Blur an email address in a screenshot",
    h1: "Blur an email address in a screenshot",
    keyword: "blur email in screenshot",
    presetProfile: "global",
    activeDetectors: ["email"],
    introText: "Drop a customer thread or admin panel and Redaktix looks for email addresses in the recognized text. It also catches card numbers, IBAN, TCKN and VKN. You review each suggestion, then blur or black it out before you copy the image. The file stays in this tab.",
    exampleCodeOrImage: "From: ada@example.com\nTicket: Please reset the staging login",
    faqList: [
      { question: "Can I blur instead of using a black bar?", answer: "Yes. Choose Blur in the editor, then use Redact on the email suggestion. The default tool is a black bar." },
      { question: "Are incomplete phrases treated as emails?", answer: "A value needs a local part and a real domain. Loose words without an @ sign are not listed as emails." },
    ],
    relatedSlugs: ["redact-phone-number", "hide-api-key"],
  }),
  tool({
    slug: "redact-phone-number",
    lang: "en",
    title: "Redact a phone number in a screenshot",
    h1: "Redact a phone number in a screenshot",
    keyword: "redact phone number screenshot",
    presetProfile: "global",
    activeDetectors: ["phone"],
    introText: "Use this page for support captures that show a mobile or landline number. Redaktix reads the line with local OCR, including numbers whose trunk prefix is split by a space, and waits for you to confirm the box. It also catches card numbers, IBAN, TCKN and VKN.",
    exampleCodeOrImage: "Tel: +1 415 555 0136\nCallback after 16:00",
    faqList: [
      { question: "Why was a version number ignored?", answer: "IP addresses, card numbers, dates, and version strings are not treated as phone numbers." },
      { question: "Does the number get sent to a phone API?", answer: "No. Detection and redaction both finish in the browser. There is no phone lookup service." },
    ],
    relatedSlugs: ["blur-email", "hide-ip-address"],
  }),
  tool({
    slug: "hide-ip-address",
    lang: "en",
    title: "Hide an IP address in a screenshot",
    h1: "Hide an IP address in a screenshot",
    keyword: "hide ip address screenshot",
    presetProfile: "global",
    activeDetectors: ["ipv4", "ipv6"],
    introText: "Server logs and status pages often show internal IPv4 addresses. This tool flags those addresses, including an optional port, so you can cover them before the screenshot leaves your machine. It also catches card numbers, IBAN, TCKN and VKN.",
    exampleCodeOrImage: "upstream 10.0.4.18:8443 connected\nedge region=eu-central",
    faqList: [
      { question: "Are octets above 255 removed from the list?", answer: "Yes. A group such as 999.1.1.1 is not offered as an IP address." },
      { question: "Does this include private ranges?", answer: "Yes. Addresses in private ranges are still sensitive on a screenshot and are eligible suggestions." },
    ],
    relatedSlugs: ["hide-api-key", "redact-phone-number"],
  }),
  tool({
    slug: "redact-credit-card",
    lang: "en",
    title: "Redact a credit card number in a screenshot",
    h1: "Redact a credit card number in a screenshot",
    keyword: "redact credit card screenshot",
    presetProfile: "global",
    activeDetectors: ["credit_card"],
    introText: "Checkout and billing captures can contain a grouped card number. Redaktix keeps a number only when it passes the Luhn check and is not a single repeated digit, then lets you cover that region locally. It also catches card numbers, IBAN, TCKN and VKN.",
    exampleCodeOrImage: "Card ending 4242 4242 4242 4242\nExp 08/28",
    faqList: [
      { question: "What happens if the number fails the Luhn check?", answer: "It is dropped. A failed checksum is not shown as a card suggestion." },
      { question: "Is the card number stored after I close the tab?", answer: "No. The image and the recognized text live in this tab's memory. Closing the tab clears them." },
    ],
    relatedSlugs: ["blur-email", "hide-api-key"],
  }),
  tool({
    slug: "hide-jwt-token",
    lang: "en",
    title: "Hide a JWT in a screenshot",
    h1: "Hide a JWT in a screenshot",
    keyword: "hide jwt in screenshot",
    presetProfile: "global",
    activeDetectors: ["api_token"],
    introText: "JSON Web Tokens start with eyJ and carry a session in three segments. Redaktix treats that pattern as an API token suggestion so you can hide the token without uploading the developer-tools capture. It also catches card numbers, IBAN, TCKN and VKN.",
    exampleCodeOrImage: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signature",
    faqList: [
      { question: "Why is a JWT listed as an API token?", answer: "The local detector matches the compact eyJ header.payload.signature form through the API token rules. This page prioritizes that detector and still keeps checksum ALWAYS_ON suggestions." },
      { question: "Will the token be decoded on a server?", answer: "No. The screenshot is not sent out. You can confirm that in the browser network panel using the steps on the security page." },
    ],
    relatedSlugs: ["hide-api-key", "hide-ip-address"],
  }),
  tool({
    slug: "tckn-gizle",
    lang: "tr",
    title: "Ekran görüntüsünde TCKN gizle",
    h1: "Ekran görüntüsünde TCKN gizle",
    keyword: "ekran görüntüsünde TCKN gizle",
    presetProfile: "turkey",
    activeDetectors: ["tckn"],
    introText: "Bu sayfa, Türkiye profiliyle T.C. kimlik numarası önerilerini arar. Sağlaması tutan numaralar ve etiketin yanındaki şüpheli değerler yerelde işaretlenir. Ayrıca kart numaraları, IBAN, TCKN ve VKN yakalanır. Görüntü tarayıcıdan çıkmaz.",
    exampleCodeOrImage: "T.C. Kimlik No: 10000000146\nBaşvuru kaydı: 2026-014",
    faqList: [
      { question: "Sağlama uymayan numara ne olur?", answer: "Etiketsiz ve sağlaması bozuk 11 hane elenir. T.C. Kimlik etiketinin yanındaki değer, kontrol için öneri olarak kalabilir." },
      { question: "Numara bir sorgu servisine gidiyor mu?", answer: "Hayır. OCR ve kontrol bu sekmede biter. Dışarı giden isteklerde ekran görüntüsünün pikselleri yoktur." },
    ],
    relatedSlugs: ["ekran-goruntusu-telefon-gizle", "hide-api-key"],
  }),
  tool({
    slug: "ekran-goruntusu-telefon-gizle",
    lang: "tr",
    title: "Ekran görüntüsündeki telefonu gizle",
    h1: "Ekran görüntüsündeki telefonu gizle",
    keyword: "ekran görüntüsü telefon gizle",
    presetProfile: "turkey",
    activeDetectors: ["phone"],
    introText: "Müşteri kaydı veya fiş görüntüsündeki telefon satırını yerelde bulun. Türkiye profili açıkken bu sayfa telefon önerilerini öne çıkarır. Ayrıca kart numaraları, IBAN, TCKN ve VKN yakalanır. Karalama dosyası cihazınızda üretilir.",
    exampleCodeOrImage: "Tel: 0532 111 22 33\nŞube: Kadıköy",
    faqList: [
      { question: "Boşluklu trunk öneki okunur mu?", answer: "Evet. 0 ile operatör kodu arasında boşluk olan satırlar, etiketli telefon bağlamında birleştirilebilir." },
      { question: "TCKN de karalanır mı?", answer: "Evet. TCKN, VKN, kart ve IBAN her araç sayfasında ALWAYS_ON olarak kalır; bu sayfa telefonu öne çıkarır." },
    ],
    relatedSlugs: ["tckn-gizle", "redact-phone-number"],
  }),
]);

function tool(config) {
  return Object.freeze({
    ...config,
    activeDetectors: Object.freeze([...config.activeDetectors]),
    faqList: Object.freeze(config.faqList.map((item) => Object.freeze({ ...item }))),
    relatedSlugs: Object.freeze([...config.relatedSlugs]),
  });
}

export function toolPublicPath(entry) {
  const slug = typeof entry === "string" ? entry : entry?.slug;
  const lang = typeof entry === "string"
    ? TOOLS.find((item) => item.slug === slug)?.lang
    : entry?.lang;
  if (lang === "tr") return `/tr/${slug}/`;
  return `/tools/${slug}/`;
}

export function getToolBySlug(slug) {
  return TOOLS.find((item) => item.slug === slug) || null;
}

export function sitemapPaths() {
  return ["/", "/security/", "/tools/", ...TOOLS.map((item) => toolPublicPath(item))];
}

export function resolveSiteOrigin(env = globalThis.process?.env || {}) {
  const raw = env.REDAKTIX_ORIGIN || env.PRIVACYLAB_ORIGIN || SITE_ORIGIN;
  return String(raw).replace(/\/$/, "");
}
