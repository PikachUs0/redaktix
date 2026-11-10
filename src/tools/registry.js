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
    slug: "redact-ssn-pdf",
    lang: "en",
    title: "Redact SSN from a PDF",
    h1: "Redact SSN from a PDF",
    keyword: "redact ssn from pdf",
    presetProfile: "global",
    activeDetectors: ["ssn"],
    introText: "Upload a tax form, pay stub, or benefits letter and Redaktix scans the page for Social Security numbers (SSN), names, and account data on this device before you share it. It also catches card numbers, IBAN, TCKN and VKN. Review each suggestion, then black it out or blur it — the file never leaves your browser.",
    exampleCodeOrImage: "SSN: 123-45-6789\nName: Jane Q. Public",
    faqList: [
      { question: "Is my PDF uploaded to a server?", answer: "No. Redaktix reads the page in your browser with WebAssembly OCR. The PDF bytes and the recognized text stay in this tab." },
      { question: "Can I redact an SSN on a scanned page?", answer: "Yes. Drop a PNG or JPEG scan instead of the PDF and the local editor highlights the values so you can cover them before export." },
      { question: "How does Redaktix decide an SSN is valid?", answer: "SSNs have no check digit, so Redaktix applies the official validity rules: the area number cannot be 000, 666, or 900-999, the group number cannot be 00, and the serial number cannot be 0000." },
    ],
    seoArticle: `<h2>How to Redact SSN from PDFs Locally</h2>
<p>Redacting a Social Security number from a PDF should not mean handing your tax document to a stranger's server. Redaktix redacts an SSN from a PDF entirely inside your browser: the page is rendered, read with WebAssembly OCR, and covered with a permanent redaction box before it is exported. The document is never uploaded, emailed, or stored in the cloud.</p>
<ol>
<li><strong>Drop the PDF.</strong> Use the drop area above to select a PDF, drop it onto the page, or paste a screenshot of the form. A scanned PNG or JPEG works too.</li>
<li><strong>Let local OCR read the page.</strong> Tesseract.js runs as WebAssembly on this device and returns the recognized text. Nothing leaves the tab.</li>
<li><strong>Review each SSN candidate.</strong> The SSN detector matches the 123-45-6789 pattern, tolerates spaces and hyphens, and applies the official validation rules — area not 000, 666, or 900-999, group not 00, serial not 0000. There is no check digit to verify, so structure is what gets validated. It also uses nearby labels such as "SSN", "Social Security", or "Taxpayer ID" to catch bare nine-digit blocks.</li>
<li><strong>Redact or blur.</strong> Draw a solid black bar or choose a blur style over every highlighted value, then export a flattened image or PDF you can share safely.</li>
</ol>
<h2>What Redaktix Detects in a US Tax PDF</h2>
<p>Alongside Social Security numbers, the local editor watches for the identifiers that travel with them: bank account and routing (ABA) numbers, payment card numbers that pass the Luhn check, names, and addresses printed above a signature line. You stay in control — an SSN is only covered when you confirm the suggestion, so a legitimate reference number is never silently removed.</p>
<h2>Why Local-First Privacy Matters</h2>
<p>A Social Security number cannot be changed. Once an SSN redaction is processed by an online "free PDF redactor", that number may sit in a third party's logs, backup, or analytics pipeline indefinitely. Local-first redaction removes that exposure: because the OCR engine and the redaction tool both run on your device, there is no server to breach and no data to subpoena.</p>
<p>Local processing also keeps you compliant. When you personally handle W-2s, 1099s, pay stubs, or benefits letters, keeping the raw document off remote infrastructure is the simplest way to reduce risk under privacy expectations your clients and employers already have.</p>
<h2>Verify the Zero-Upload Claim Yourself</h2>
<p>You do not have to trust a badge. Open your browser's developer tools, switch to the Network panel, enable "Preserve log", and drop the same PDF again. The file bytes never appear as an outbound request body; the only requests are same-origin files for the OCR engine and language data. See <a href="/security/">how local processing works</a> for the step-by-step check.</p>
<h2>Frequently Asked Questions</h2>
<p><strong>Does Redaktix store my Social Security number?</strong> No. The recognized text and the redaction boxes live in this tab's memory and are discarded when you close or refresh the page.</p>
<p><strong>Does redaction really remove the SSN, or just hide it?</strong> Export flattens the covered region into the output pixels, so the underlying digits are not recoverable from the exported file. Keep the original somewhere safe and share only the redacted copy.</p>
<p><strong>Can I redact multiple SSNs on one page?</strong> Yes. Every confirmed suggestion is covered, so a joint return or a multi-employee form is handled in a single pass.</p>`,
    relatedSlugs: ["anonymize-w2-tax-form", "blur-routing-number"],
  }),
  tool({
    slug: "anonymize-w2-tax-form",
    lang: "en",
    title: "Anonymize a W-2 tax form",
    h1: "Anonymize a W-2 tax form",
    keyword: "anonymize w2 form",
    presetProfile: "global",
    activeDetectors: ["credit_card"],
    introText: "Blank out a W-2 before you send it to a lender, landlord, or accountant. Redaktix detects the employee name, address, and identifier values the form carries and lets you cover them locally. It also catches card numbers, IBAN, TCKN and VKN. Export a clean image you can review or attach.",
    exampleCodeOrImage: "Form W-2 2025\nBox e: Employee name  Box f: Address",
    faqList: [
      { question: "Does this cover every box on the W-2?", answer: "You review and confirm each highlighted value. Anything Redaktix does not surface can still be covered with a manual box." },
      { question: "Where is the anonymized copy saved?", answer: "To your device only. Redaktix writes a stripped image file locally; nothing is uploaded or stored remotely." },
    ],
    seoArticle: `<h2>How to Anonymize a W-2 Tax Form</h2>
<p>A W-2 carries a full identity in a single page: an employee name, a home address, a Social Security number, wages, and withholding totals. Anonymizing a W-2 means covering those fields before the form is emailed to a lender, landlord, or accountant. Redaktix does that entirely in your browser, so the raw form is never uploaded to a document service.</p>
<ol>
<li><strong>Add the form.</strong> Drop the W-2 PDF onto the drop area above, paste a screenshot, or select a scanned image of the form.</li>
<li><strong>Run local OCR.</strong> The page is read with WebAssembly OCR on this device, producing text you can inspect without any network request.</li>
<li><strong>Confirm the sensitive boxes.</strong> Names, addresses, Social Security numbers, and payment card data are highlighted so you can approve exactly what should be hidden.</li>
<li><strong>Cover and export.</strong> Apply black bars or blur over each field and download a clean copy to attach to your application or records.</li>
</ol>
<h2>What Counts as Sensitive on a W-2</h2>
<p>Box e holds the employee name and Box f holds the mailing address. Identifiers such as the SSN, and any direct-deposit routing or account numbers printed on the stub, are the values most often targeted by identity theft. Redaktix surfaces all of them locally, so you can anonymize a W-2 without exposing the very data you are trying to protect.</p>
<h2>Why Local-First Privacy Matters</h2>
<p>The moment you upload a tax form to an online anonymizer, you are trusting that vendor's servers, staff, and data-retention policy. A local-first tool flips that model: the OCR engine and the redaction editor run on your device, so there is no server copy to leak, sell, or hand over. For tax documents that are only meant to be shared with one recipient, that is the difference between a controlled disclosure and an uncontrolled one.</p>
<p>It is also faster and works offline. Because nothing round-trips to a backend, anonymizing a W-2 is instant and keeps working on a plane, on a school network, or behind a corporate firewall that blocks document uploads.</p>
<h2>Redact Before You Share</h2>
<p>When a lender asks for "your W-2", they usually need income and employer details — not your full Social Security number. Cover the SSN and any bank numbers, then send the redacted copy. See <a href="/security/">how local processing works</a> to confirm the form never leaves your browser.</p>
<h2>Frequently Asked Questions</h2>
<p><strong>Is the W-2 uploaded to Redaktix?</strong> No. There is no Redaktix upload endpoint. The PDF bytes and recognized text stay in this tab and are cleared when you close it.</p>
<p><strong>Can I anonymize a W-2 on my phone?</strong> Yes. The same browser-based editor works on mobile, and you can install Redaktix as an app for offline use.</p>
<p><strong>Will the redaction hold up if someone inspects the file?</strong> Export flattens the covered pixels, so the hidden values are no longer present as recoverable data in the exported copy.</p>`,
    relatedSlugs: ["redact-ssn-pdf", "blur-routing-number"],
  }),
  tool({
    slug: "blur-routing-number",
    lang: "en",
    title: "Blur a bank routing number",
    h1: "Blur a bank routing number",
    keyword: "blur routing number",
    presetProfile: "global",
    activeDetectors: ["routing_number"],
    introText: "A bank routing (ABA) number sits next to the account number on checks and deposit slips. Redaktix reads the page locally so you can blur or black out the routing line before a screenshot leaves your machine. It also catches card numbers, IBAN, TCKN and VKN, and never uploads the image.",
    exampleCodeOrImage: "Routing (ABA): 021000021\nAccount: 000123456789",
    faqList: [
      { question: "Can I blur instead of a solid black bar?", answer: "Yes. Pick Blur in the editor, then redact the routing number region. The default style is a black bar." },
      { question: "Is the routing number checked against a bank database?", answer: "No. Redaktix does not call a lookup service. You confirm each suggested region yourself." },
    ],
    seoArticle: `<h2>How to Blur a Bank Routing Number</h2>
<p>A bank routing number, also called an ABA number, is the nine-digit code at the bottom of a check and on every deposit slip. Together with an account number it is enough to set up an unauthorized transfer, which is why you should blur it before a check image or banking screenshot is posted anywhere. Redaktix finds the routing number locally and lets you blur or black it out without uploading the image.</p>
<ol>
<li><strong>Add the check or screenshot.</strong> Drop a photo of the check, a banking screenshot, or a PDF statement onto the drop area above.</li>
<li><strong>Scan locally.</strong> WebAssembly OCR reads the page in this browser and returns the digit strings it recognizes.</li>
<li><strong>Review the routing candidate.</strong> The routing-number detector validates the ABA prefix (00-12, 21-32, 61-72, 80) and the mod-10 checksum, so random nine-digit numbers are not offered.</li>
<li><strong>Blur or redact, then export.</strong> Choose the blur style for a softer look or a solid bar for hard removal, and download a clean copy.</li>
</ol>
<h2>Why a Routing Number Is Sensitive</h2>
<p>A routing number on its own identifies a financial institution, but paired with the account number printed beside it, it authorizes direct debits and ACH transfers. That is exactly the combination shown on the bottom line of a check. Blurring the routing line while leaving the rest of the check legible is a common, sensible way to share proof of payment without handing over the ability to move money.</p>
<h2>Why Local-First Privacy Matters</h2>
<p>Check images and bank statements are among the most direct paths to a drained account, so they are the last thing you should feed to an unknown web tool. A local-first redactor keeps the image in your browser: no upload, no server-side copy, and no vendor retention policy to interpret. Because the ABA validation and checksum run on your device, you also get the result instantly and offline.</p>
<p>This matters beyond convenience. When you blur a routing number for a landlord, a marketplace, or a reimbursement form, you want certainty that the original image — the one with the full account number — never touched the internet at all.</p>
<h2>Confirm Nothing Is Uploaded</h2>
<p>Open developer tools, go to the Network panel, enable "Preserve log", and repeat the blur. The check image never appears as an outbound request body; the only traffic is same-origin OCR assets. See <a href="/security/">how local processing works</a> for the full walkthrough.</p>
<h2>Frequently Asked Questions</h2>
<p><strong>Does Redaktix call a bank lookup API?</strong> No. The routing number is validated entirely offline with a prefix check and a mod-checksum, then left for you to confirm.</p>
<p><strong>Should I blur or fully redact the routing number?</strong> Blur is usually enough to defeat automated reading while keeping the check visually intact; choose a solid black bar when you want the digits gone for good.</p>
<p><strong>Does blurring actually protect the number?</strong> Export flattens the blurred pixels into the image, so the original digits are not recoverable from the exported file. Keep the unblurred original private and share only this copy.</p>`,
    relatedSlugs: ["anonymize-w2-tax-form", "redact-ssn-pdf"],
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
  return `/tools/${slug}/`;
}

export function getToolBySlug(slug) {
  return TOOLS.find((item) => item.slug === slug) || null;
}

export function sitemapPaths() {
  return ["/", "/security/", "/verify/", "/tools/", ...TOOLS.map((item) => toolPublicPath(item))];
}

export function resolveSiteOrigin(env = globalThis.process?.env || {}) {
  const raw = env.REDAKTIX_ORIGIN || env.PRIVACYLAB_ORIGIN || SITE_ORIGIN;
  return String(raw).replace(/\/$/, "");
}
