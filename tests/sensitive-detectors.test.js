import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectCreditCard,
  detectEmail,
  detectIPv4,
  detectIPv6,
  detectVkn,
  extractIbanCandidates,
  mergeGroupedOcrWords,
  mergeIpv6OcrWords,
  envelopeForMatchedWords,
  getMatchBoundingBoxes,
  extractApiTokenCandidates,
  extractLocationCandidates,
  extractPersonNameCandidates,
  detectPhonesInScan,
  extractPhoneCandidates,
  extractPhoneMatchesFromOcrWords,
  findTcknMatches,
  isValidTckn,
  passesLuhn,
} from "../src/js/sensitive-detectors.js";

function texts(detections) {
  return detections.map((detection) => detection.text);
}

describe("email", () => {
  it("accepts a standard address", () => {
    assert.deepEqual(texts(detectEmail("developer@example.com")), ["developer@example.com"]);
  });

  it("accepts a dotted local part and a country-code domain", () => {
    assert.deepEqual(texts(detectEmail("jane.smith@company.co.uk")), ["jane.smith@company.co.uk"]);
    assert.deepEqual(texts(detectEmail("user+filter@mail.co.uk")), ["user+filter@mail.co.uk"]);
  });

  it("rejects phrases and incomplete domains", () => {
    assert.deepEqual(texts(detectEmail("customer support")), []);
    assert.deepEqual(texts(detectEmail("user@example")), []);
    assert.deepEqual(texts(detectEmail("example.com")), []);
  });
});

describe("ipv4", () => {
  it("accepts private addresses and an optional port", () => {
    assert.deepEqual(texts(detectIPv4("192.168.1.10")), ["192.168.1.10"]);
    assert.deepEqual(texts(detectIPv4("10.0.0.1")), ["10.0.0.1"]);
    assert.deepEqual(texts(detectIPv4("172.16.0.1:8080")), ["172.16.0.1:8080"]);
  });

  it("rejects octets above 255", () => {
    assert.deepEqual(texts(detectIPv4("999.168.1.1")), []);
    assert.deepEqual(texts(detectIPv4("256.0.0.1")), []);
  });
});

describe("ipv6", () => {
  it("accepts a full address, a compressed address, and a port suffix", () => {
    assert.deepEqual(
      texts(detectIPv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334")),
      ["2001:0db8:85a3:0000:0000:8a2e:0370:7334"]
    );
    assert.deepEqual(texts(detectIPv6("2001:db8::1")), ["2001:db8::1"]);
    assert.deepEqual(texts(detectIPv6("::1")), ["::1"]);
    assert.deepEqual(texts(detectIPv6("[2001:db8::1]:443")), ["[2001:db8::1]:443"]);
    assert.deepEqual(
      texts(detectIPv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334:8080")),
      ["2001:0db8:85a3:0000:0000:8a2e:0370:7334:8080"]
    );
  });

  it("rejects a short hex list and a MAC address", () => {
    assert.deepEqual(texts(detectIPv6("cafe:babe")), []);
    assert.deepEqual(texts(detectIPv6("aa:bb:cc:dd:ee:ff")), []);
  });

  it("merges colon-separated hex blocks into one bounding box", () => {
    const parts = ["2001:", "0db8:", "85a3:", "0000:", "0000:", "8a2e:", "0370:", "7334"];
    const words = parts.map((text, index) => ({
      text,
      bbox: { x: index * 48, y: 12, width: 44, height: 16 },
    }));
    const matches = mergeIpv6OcrWords(words);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].text, "2001:0db8:85a3:0000:0000:8a2e:0370:7334");
    assert.equal(matches[0].bbox.x, 0);
    assert.equal(matches[0].bbox.width, 7 * 48 + 44);
    assert.equal(matches[0].words.length, 8);

    const split = ["2001", ":", "0db8", ":", "85a3", ":", "0000", ":", "0000", ":", "8a2e", ":", "0370", ":", "7334"];
    const splitWords = split.map((text, index) => ({
      text,
      bbox: { x: index * 28, y: 40, width: text === ":" ? 8 : 24, height: 16 },
    }));
    const splitMatches = mergeIpv6OcrWords(splitWords);
    assert.equal(splitMatches[0].text, "2001:0db8:85a3:0000:0000:8a2e:0370:7334");
    assert.equal(splitMatches[0].words.length, split.length);
  });
});

describe("phone", () => {
  it("accepts a Turkish mobile number and other international plus-numbers", () => {
    assert.deepEqual(extractPhoneCandidates("+90 555 000 1122"), ["+90 555 000 1122"]);
    assert.deepEqual(extractPhoneCandidates("+1 415 555 0134"), ["+1 415 555 0134"]);
    assert.deepEqual(extractPhoneCandidates("+44 20 7946 0958"), ["+44 20 7946 0958"]);
    assert.deepEqual(extractPhoneCandidates("+49 30 901820"), ["+49 30 901820"]);
    assert.deepEqual(extractPhoneCandidates("+33 1 42 68 53 00"), ["+33 1 42 68 53 00"]);
  });

  it("keeps a local Turkish mobile number that uses a known carrier prefix", () => {
    assert.deepEqual(extractPhoneCandidates("0555 000 1122"), ["0555 000 1122"]);
  });

  it("does not treat IP addresses, grouped card numbers, dates, or versions as phones", () => {
    assert.deepEqual(extractPhoneCandidates("192.168.1.10"), []);
    assert.deepEqual(extractPhoneCandidates("4111 1111 1111 1111"), []);
    assert.deepEqual(extractPhoneCandidates("2026-09-29"), []);
    assert.deepEqual(extractPhoneCandidates("1.2.3"), []);
  });

  it("accepts Turkish 0090 notation and still checks the carrier prefix", () => {
    assert.deepEqual(extractPhoneCandidates("0090 555 000 1122"), ["0090 555 000 1122"]);
    assert.deepEqual(extractPhoneCandidates("00905550001122"), ["00905550001122"]);
    assert.deepEqual(extractPhoneCandidates("0090 570 000 1122"), []);
  });

  it("does not apply Turkish carrier rules to other international prefixes", () => {
    assert.deepEqual(extractPhoneCandidates("+44 20 7946 0958"), ["+44 20 7946 0958"]);
    assert.deepEqual(extractPhoneCandidates("0044 20 7946 0958"), ["0044 20 7946 0958"]);
    assert.deepEqual(extractPhoneCandidates("001 415 555 0134"), ["001 415 555 0134"]);
  });

  it("accepts a Turkish landline whose trunk prefix is separated by a space", () => {
    assert.deepEqual(extractPhoneCandidates("0 212 555 12 34"), ["0 212 555 12 34"]);
  });

  it("accepts a Turkish mobile number written after Tel with a spaced trunk prefix", () => {
    assert.deepEqual(extractPhoneCandidates("Tel: 0 555 123 4567"), ["0 555 123 4567"]);
    assert.deepEqual(extractPhoneCandidates("Tel: O 555 123 4567"), ["0 555 123 4567"]);
    assert.deepEqual(extractPhoneCandidates("Tel: O5551234567"), ["05551234567"]);
  });

  it("keeps a labeled local number when the digit groups are not a known carrier prefix", () => {
    assert.deepEqual(extractPhoneCandidates("Tel: O 585 123 4567"), ["0 585 123 4567"]);
    assert.deepEqual(extractPhoneCandidates("0 585 123 4567"), []);
  });

  it("builds a phone match from OCR words on one row when the label and number are far apart", () => {
    const words = [
      { text: "Tel:", bbox: { x: 8, y: 40, width: 36, height: 16 } },
      { text: "0", bbox: { x: 220, y: 40, width: 14, height: 16 } },
      { text: "555", bbox: { x: 250, y: 41, width: 36, height: 16 } },
      { text: "123", bbox: { x: 300, y: 40, width: 36, height: 16 } },
      { text: "4567", bbox: { x: 348, y: 40, width: 44, height: 16 } },
    ];
    const matches = extractPhoneMatchesFromOcrWords(words);
    assert.deepEqual(matches.map((match) => match.text), ["0 555 123 4567"]);
    assert.deepEqual(matches[0].words.map((word) => word.text), ["0", "555", "123", "4567"]);
    const box = envelopeForMatchedWords(matches[0].words, matches[0].text);
    assert.equal(box.x0, 220);
    assert.equal(box.x1, 392);
  });

  it("returns a scan detection for a letter O trunk and ignores later non-digit tokens", () => {
    const words = [
      { text: "Tel", lineId: "0-0-4", confidence: 91, bbox: { x0: 12, y0: 100, x1: 48, y1: 124 } },
      { text: "O", lineId: "0-0-4", confidence: 88, bbox: { x0: 62, y0: 100, x1: 76, y1: 124 } },
      { text: "555", lineId: "0-0-4", confidence: 90, bbox: { x0: 87, y0: 100, x1: 123, y1: 124 } },
      { text: "123", lineId: "0-0-4", confidence: 87, bbox: { x0: 135, y0: 100, x1: 171, y1: 124 } },
      { text: "4567", lineId: "0-0-4", confidence: 86, bbox: { x0: 182, y0: 100, x1: 230, y1: 124 } },
      { text: "K12", lineId: "0-0-4", confidence: 80, bbox: { x0: 244, y0: 100, x1: 280, y1: 124 } },
      { text: "Ab9xyz", lineId: "0-0-4", confidence: 80, bbox: { x0: 294, y0: 100, x1: 360, y1: 124 } },
    ];
    const detections = detectPhonesInScan(words, 1000, 400);
    assert.equal(detections.length, 1);
    assert.equal(detections[0].type, "phone");
    assert.equal(detections[0].label, "Possible phone number");
    assert.equal(detections[0].text, "0 555 123 4567");
    assert.equal(detections[0].normX, 0.062);
    assert.equal(detections[0].normWidth, 0.168);
    assert.ok(detections[0].normX > 48 / 1000);
    assert.ok(detections[0].normX + detections[0].normWidth <= 244 / 1000);
    const originalWords = words.filter((word) => ["O", "555", "123", "4567"].includes(word.text));
    const box = envelopeForMatchedWords(originalWords, "0 555 123 4567");
    assert.equal(box.x0, 62);
    assert.equal(box.x1, 230);
  });

  it("does not join a phone number that continues on the next line", () => {
    const words = [
      { text: "Tel:", bbox: { x: 8, y: 40, width: 36, height: 16 } },
      { text: "0", bbox: { x: 60, y: 40, width: 14, height: 16 } },
      { text: "555", bbox: { x: 80, y: 40, width: 36, height: 16 } },
      { text: "123", bbox: { x: 8, y: 72, width: 36, height: 16 } },
      { text: "4567", bbox: { x: 52, y: 72, width: 44, height: 16 } },
    ];
    assert.deepEqual(extractPhoneMatchesFromOcrWords(words), []);
  });
});

describe("credit card", () => {
  it("keeps a grouped test number that passes Luhn", () => {
    assert.equal(passesLuhn("4242424242424242"), true);
    assert.deepEqual(texts(detectCreditCard("4242 4242 4242 4242")), ["4242 4242 4242 4242"]);
    assert.deepEqual(texts(detectCreditCard("4242-4242-4242-4242")), ["4242-4242-4242-4242"]);
    assert.deepEqual(texts(detectCreditCard("card 4242424242424242.")), ["4242424242424242"]);
  });

  it("drops a grouped number that fails Luhn", () => {
    assert.equal(passesLuhn("1234567890123456"), false);
    assert.deepEqual(texts(detectCreditCard("1234 5678 9012 3456")), []);
  });

  it("drops a grouped number made of one repeated digit even when it passes Luhn", () => {
    assert.equal(passesLuhn("0000000000000000"), true);
    assert.equal(passesLuhn("8888888888888888"), true);
    assert.deepEqual(texts(detectCreditCard("0000 0000 0000 0000")), []);
    assert.deepEqual(texts(detectCreditCard("8888 8888 8888 8888")), []);
  });
});

describe("api tokens", () => {
  it("rejects ordinary log identifiers", () => {
    assert.deepEqual(extractApiTokenCandidates("ActiveRulesetsPII_BASICFINANCIAL_STANDARD_CREDENTIALS_DEEP_TR_TAX_IDENTITY"), []);
    assert.deepEqual(extractApiTokenCandidates("PermissionsgrantedCAMERAWRITE_EXTERNAL_STORAGE"), []);
    assert.deepEqual(extractApiTokenCandidates("StartingOCRprocessingforimagescan_invoice_123"), []);
  });

  it("keeps a full explicit token and a high-entropy secret", () => {
    assert.deepEqual(
      extractApiTokenCandidates("sk_live_51H7xK2aBcDeFgHiJkLmNoPqRsTuVwXyZ"),
      ["sk_live_51H7xK2aBcDeFgHiJkLmNoPqRsTuVwXyZ"]
    );
    assert.deepEqual(
      extractApiTokenCandidates("ghp_abcdefghijklmnopqrst"),
      ["ghp_abcdefghijklmnopqrst"]
    );
    assert.deepEqual(
      extractApiTokenCandidates("k3J9sQ2mN8pL5aR1tY6wZ4cV7dF0gH2jK5mN8pQ1rS3"),
      ["k3J9sQ2mN8pL5aR1tY6wZ4cV7dF0gH2jK5mN8pQ1rS3"]
    );
  });

  it("keeps a truncated explicit token and an OCR space before a digit fragment", () => {
    assert.deepEqual(extractApiTokenCandidates("sk_live_51H7xK2aBcDeF"), ["sk_live_51H7xK2aBcDeF"]);
    assert.deepEqual(extractApiTokenCandidates("sk_live_processingstarted"), []);
    assert.deepEqual(
      extractApiTokenCandidates("api_test_abcd 1234efgh5678"),
      ["api_test_abcd 1234efgh5678"]
    );
    assert.deepEqual(
      extractApiTokenCandidates("ghp_abcdefghij 1234567890abcd"),
      ["ghp_abcdefghij 1234567890abcd"]
    );
  });

  it("does not flag spaced prose as an API token", () => {
    assert.deepEqual(extractApiTokenCandidates("ibaresi olmasa dahi resmi bir belge hükmündedir"), []);
    assert.deepEqual(extractApiTokenCandidates("ibaresi olmasa dahi 10000000146"), []);
  });
});

describe("tckn", () => {
  it("accepts checksum-valid Turkish IDs, including an OCR letter correction", () => {
    assert.equal(isValidTckn("12345678950"), true);
    assert.equal(isValidTckn("10000000146"), true);
    assert.deepEqual(findTcknMatches("12345678950").map((match) => match.text), ["12345678950"]);
    assert.deepEqual(findTcknMatches("10000000146"), [
      {
        text: "10000000146",
        span: "10000000146",
        labeled: false,
        confidence: 0.98,
        padding: 0,
      },
    ]);
    assert.deepEqual(findTcknMatches("1OOOOOOO146").map((match) => match.text), ["10000000146"]);
    assert.equal(findTcknMatches("1OOOOOOO146")[0].span, "1OOOOOOO146");
    assert.deepEqual(findTcknMatches("1234S6789S0").map((match) => match.text), ["12345678950"]);
    assert.equal(findTcknMatches("|2345678950")[0].text, "12345678950");
    assert.equal(findTcknMatches("1234567B950")[0].text, "12345678950");
    assert.equal(findTcknMatches("1234s6789s0")[0].span, "1234s6789s0");
    assert.deepEqual(findTcknMatches("100000000S0"), []);
    assert.deepEqual(findTcknMatches("Görsele12345678950").map((match) => match.text), ["12345678950"]);
    assert.equal(findTcknMatches("Görsele12345678950")[0].span, "12345678950");
    assert.deepEqual(findTcknMatches("1234567895O").map((match) => match.text), ["12345678950"]);
    assert.deepEqual(findTcknMatches("4111111111111111"), []);
    assert.deepEqual(findTcknMatches("Kimlik:12345678950").map((match) => match.text), ["12345678950"]);
    assert.deepEqual(findTcknMatches("12345678950: ").map((match) => match.text), ["12345678950"]);
  });

  it("keeps every copy of the same valid TCKN", () => {
    const matches = findTcknMatches("12345678950\n12345678950");
    assert.equal(matches.length, 2);
    assert.deepEqual(matches.map((match) => match.text), ["12345678950", "12345678950"]);
    assert.equal(matches[1].occurrence, 1);

    const words = [
      { text: "12345678950", lineIndex: 0, bbox: { x0: 10, y0: 8, x1: 140, y1: 24 } },
      { text: "12345678950", lineIndex: 1, bbox: { x0: 10, y0: 48, x1: 140, y1: 64 } },
    ];
    assert.equal(getMatchBoundingBoxes(words, "12345678950", 0).y0, 8);
    assert.equal(getMatchBoundingBoxes(words, "12345678950", 1).y0, 48);
  });

  it("fails silently when the official checksum does not pass", () => {
    for (const number of ["10000000050", "52194837260", "01234567890", "12345678901"]) {
      assert.equal(isValidTckn(number), false);
      assert.deepEqual(findTcknMatches(number), []);
      assert.deepEqual(findTcknMatches(`T.C. Kimlik No: ${number}`), []);
    }
  });

  it("keeps the TCKN box on its own line when the next line is prose", () => {
    const words = [
      { text: "TCKN", lineIndex: 0, bbox: { x0: 12, y0: 8, x1: 70, y1: 24 } },
      { text: "10000000050", lineIndex: 0, bbox: { x0: 80, y0: 8, x1: 230, y1: 24 } },
      { text: "ibaresi", lineIndex: 1, bbox: { x0: 10, y0: 40, x1: 86, y1: 56 } },
      { text: "olmasa", lineIndex: 1, bbox: { x0: 94, y0: 40, x1: 170, y1: 56 } },
      { text: "dahi", lineIndex: 1, bbox: { x0: 178, y0: 40, x1: 230, y1: 56 } },
    ];
    const box = getMatchBoundingBoxes(words, "10000000050");
    assert.equal(box.x0, 80);
    assert.equal(box.y0, 8);
    assert.equal(box.x1, 230);
    assert.equal(box.y1, 24);
    assert.equal(envelopeForMatchedWords(words, "10000000050").y0, 8);
  });
});

describe("tax id", () => {
  it("keeps a standalone 10-digit tax number and ignores longer digit runs", () => {
    assert.deepEqual(texts(detectVkn("Vergi No:1234567890")), ["1234567890"]);
    assert.deepEqual(texts(detectVkn("1234567890 ")), ["1234567890"]);
    assert.deepEqual(texts(detectVkn("12345678901")), []);
    assert.deepEqual(texts(detectVkn("0123456789012345")), []);
  });
});

describe("grouped secrets", () => {
  it("keeps cloud keys, a bearer token, and a database url", () => {
    assert.deepEqual(extractApiTokenCandidates("AKIAIOSFODNN7EXAMPLE"), ["AKIAIOSFODNN7EXAMPLE"]);
    assert.deepEqual(extractApiTokenCandidates("ASIAIOSFODNN7EXAMPLE"), ["ASIAIOSFODNN7EXAMPLE"]);
    assert.ok(extractApiTokenCandidates("sk-proj-abcDEF1234567890ghij_klmnop").includes("sk-proj-abcDEF1234567890ghij_klmnop"));
    assert.ok(extractApiTokenCandidates("sk-admin-abcDEF1234567890ghij").includes("sk-admin-abcDEF1234567890ghij"));
    const github = `ghp_${"a1".repeat(18)}`;
    assert.deepEqual(extractApiTokenCandidates(github), [github]);
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVP";
    assert.deepEqual(extractApiTokenCandidates(jwt), [jwt]);
    const database = "postgresql://app_user:s3cret@db.internal:5432/redaktix";
    assert.deepEqual(extractApiTokenCandidates(database), [database]);
    const awsSecret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    assert.equal(awsSecret.length, 40);
    assert.deepEqual(extractApiTokenCandidates(awsSecret), [awsSecret]);
  });

  it("covers every IBAN block and every card group in one box", () => {
    const ibanParts = ["TR33", "0006", "1005", "1978", "6457", "8413", "26"];
    const ibanWords = ibanParts.map((text, index) => ({
      text,
      bbox: { x: index * 52, y: 12, width: 44, height: 16 },
    }));
    const iban = mergeGroupedOcrWords(ibanWords);
    assert.equal(iban.length, 1);
    assert.equal(iban[0].text, "TR33 0006 1005 1978 6457 8413 26");
    assert.equal(iban[0].bbox.x, 0);
    assert.equal(iban[0].bbox.width, 6 * 52 + 44);

    const cardParts = ["4242", "4242", "4242", "4242"];
    const cardWords = cardParts.map((text, index) => ({
      text,
      bbox: { x: index * 58, y: 40, width: 48, height: 16 },
    }));
    const card = mergeGroupedOcrWords(cardWords);
    assert.equal(card.length, 1);
    assert.equal(card[0].text, "4242 4242 4242 4242");
    assert.equal(card[0].bbox.x, 0);
    assert.equal(card[0].bbox.width, 3 * 58 + 48);
    assert.equal(getMatchBoundingBoxes(cardWords, card[0].text).x1, 3 * 58 + 48);

    const emailWords = [
      { text: "user+filter", bbox: { x: 8, y: 70, width: 90, height: 16 } },
      { text: "@mail.co.uk", bbox: { x: 100, y: 70, width: 110, height: 16 } },
    ];
    const email = mergeGroupedOcrWords(emailWords);
    assert.equal(email.length, 1);
    assert.equal(email[0].text, "user+filter@mail.co.uk");
    assert.equal(email[0].bbox.x, 8);
    assert.equal(email[0].bbox.width, 202);
  });

  it("reads a global IBAN with spaces", () => {
    assert.deepEqual(
      extractIbanCandidates("DE89 3704 0044 0532 0130 00"),
      ["DE89 3704 0044 0532 0130 00"]
    );
    assert.deepEqual(
      extractIbanCandidates("GB29NWBK60161331926819"),
      ["GB29NWBK60161331926819"]
    );
  });
});

describe("person names", () => {
  it("matches Turkish given-name and surname pairs that are in the current lists", () => {
    assert.deepEqual(extractPersonNameCandidates("Ad Soyad: Ahmet Yılmaz"), ["Ahmet Yılmaz"]);
    assert.deepEqual(extractPersonNameCandidates("Müşteri Adı: Zeynep Kaya"), ["Zeynep Kaya"]);
  });

  it("reads a person name that follows a clear English or Turkish label", () => {
    assert.deepEqual(extractPersonNameCandidates("Name: Daniel Foster"), ["Daniel Foster"]);
    assert.deepEqual(extractPersonNameCandidates("Customer: Maria Garcia"), ["Maria Garcia"]);
    assert.deepEqual(extractPersonNameCandidates("Employee Name: Alex Johnson"), ["Alex Johnson"]);
    assert.deepEqual(extractPersonNameCandidates("Contact Person: Emma Smith"), ["Emma Smith"]);
    assert.deepEqual(extractPersonNameCandidates("Account Holder: Luca Rossi"), ["Luca Rossi"]);
  });

  it("stops the name before the next field label", () => {
    assert.deepEqual(
      extractPersonNameCandidates("Name: Daniel Foster Email: dev@example.com"),
      ["Daniel Foster"]
    );
    assert.deepEqual(
      extractPersonNameCandidates("Name: Daniel Foster Customer: Maria Garcia"),
      ["Daniel Foster", "Maria Garcia"]
    );
  });

  it("covers the name value and leaves the label outside the box", () => {
    const [name] = extractPersonNameCandidates("Name: Daniel Foster");
    const box = envelopeForMatchedWords([
      { text: "Name:", bbox: { x: 0, y: 8, width: 52, height: 16 } },
      { text: "Daniel", bbox: { x: 60, y: 8, width: 64, height: 16 } },
      { text: "Foster", bbox: { x: 130, y: 8, width: 62, height: 16 } },
    ], name);
    assert.equal(name, "Daniel Foster");
    assert.equal(box.x0, 60);
    assert.equal(box.x1, 192);
    assert.equal(box.y0, 8);
  });

  it("rejects an empty or numeric value after a name label", () => {
    assert.deepEqual(extractPersonNameCandidates("Name:"), []);
    assert.deepEqual(extractPersonNameCandidates("Name: 12345"), []);
    assert.deepEqual(extractPersonNameCandidates("Name: 123456"), []);
    assert.deepEqual(extractPersonNameCandidates("Name: daniel@example.com"), []);
    assert.deepEqual(extractPersonNameCandidates("Contact: +44 20 7946 0958"), []);
  });

  it("drops a Turkish possessive suffix and repeated copies of the same name", () => {
    assert.deepEqual(extractPersonNameCandidates("Cenk Kaya'nın"), ["Cenk Kaya"]);
    assert.deepEqual(extractPersonNameCandidates("Cenk Kaya’nın"), ["Cenk Kaya"]);
    assert.deepEqual(extractPersonNameCandidates("Cenk Kaya'nın Cenk Kaya'nın"), ["Cenk Kaya"]);
    assert.deepEqual(extractPersonNameCandidates("Ad Soyad: Cenk Kaya'nın"), ["Cenk Kaya"]);
    assert.deepEqual(extractPersonNameCandidates("AYŞE YILMAZ'IN"), ["AYŞE YILMAZ"]);
  });

  it("keeps an uppercase Turkish name and a genuine apostrophe inside a labeled name", () => {
    assert.deepEqual(extractPersonNameCandidates("AYŞE YILMAZ"), ["AYŞE YILMAZ"]);
    assert.deepEqual(extractPersonNameCandidates("Name: Patrick O'Brien"), ["Patrick O'Brien"]);
  });

  it("covers the whole surname token when the suggestion omits the possessive suffix", () => {
    const [name] = extractPersonNameCandidates("Cenk Kaya'nın");
    const box = envelopeForMatchedWords([
      { text: "Cenk", bbox: { x: 0, y: 8, width: 40, height: 16 } },
      { text: "Kaya'nın", bbox: { x: 48, y: 8, width: 80, height: 16 } },
    ], name);
    assert.equal(name, "Cenk Kaya");
    assert.equal(box.x0, 0);
    assert.equal(box.x1, 128);
    assert.equal(box.y0, 8);
  });

  it("does not treat interface headings as person names", () => {
    assert.deepEqual(extractPersonNameCandidates("Customer Support"), []);
    assert.deepEqual(extractPersonNameCandidates("Account Details"), []);
    assert.deepEqual(extractPersonNameCandidates("Privacy Settings"), []);
    assert.deepEqual(extractPersonNameCandidates("Security Center"), []);
    assert.deepEqual(extractPersonNameCandidates("Full Name"), []);
    assert.deepEqual(extractPersonNameCandidates("Name"), []);
    assert.deepEqual(extractPersonNameCandidates("Download Image"), []);
  });
});

describe("locations", () => {
  it("matches a Turkish province written after Konum", () => {
    assert.deepEqual(extractLocationCandidates("Konum: İstanbul"), ["İstanbul"]);
  });

  it("reads a place or address that follows a clear label", () => {
    assert.deepEqual(extractLocationCandidates("Location: Berlin, Germany"), ["Berlin, Germany"]);
    assert.deepEqual(extractLocationCandidates("City: London"), ["London"]);
    assert.deepEqual(extractLocationCandidates("Country: Canada"), ["Canada"]);
    assert.deepEqual(extractLocationCandidates("Billing Address: 123 Main Street, Toronto"), ["123 Main Street, Toronto"]);
    assert.deepEqual(extractLocationCandidates("Office: Paris"), ["Paris"]);
    assert.deepEqual(extractLocationCandidates("Adres: Atatürk Caddesi 10, Ankara"), ["Atatürk Caddesi 10, Ankara"]);
  });

  it("stops the location value before the next field label", () => {
    assert.deepEqual(
      extractLocationCandidates("Location: Berlin, Germany Email: dev@example.com"),
      ["Berlin, Germany"]
    );
  });

  it("covers the location value and leaves the label outside the box", () => {
    const [place] = extractLocationCandidates("Location: Berlin, Germany");
    const box = envelopeForMatchedWords([
      { text: "Location:", bbox: { x: 0, y: 8, width: 80, height: 16 } },
      { text: "Berlin,", bbox: { x: 90, y: 8, width: 70, height: 16 } },
      { text: "Germany", bbox: { x: 168, y: 8, width: 74, height: 16 } },
    ], place);
    assert.equal(place, "Berlin, Germany");
    assert.equal(box.x0, 90);
    assert.equal(box.x1, 242);
  });

  it("does not match a province that has no location context", () => {
    assert.deepEqual(extractLocationCandidates("Konya"), []);
  });

  it("does not match location headings or an empty label", () => {
    assert.deepEqual(extractLocationCandidates("Location Settings"), []);
    assert.deepEqual(extractLocationCandidates("Address Book"), []);
    assert.deepEqual(extractLocationCandidates("Office Tools"), []);
    assert.deepEqual(extractLocationCandidates("City Guide"), []);
    assert.deepEqual(extractLocationCandidates("Country Selector"), []);
    assert.deepEqual(extractLocationCandidates("Location:"), []);
  });

  it("reads values after the remaining English location and address labels", () => {
    assert.deepEqual(extractLocationCandidates("Address: 10 Downing Street"), ["10 Downing Street"]);
    assert.deepEqual(extractLocationCandidates("Street address: 123 Main Street"), ["123 Main Street"]);
    assert.deepEqual(extractLocationCandidates("Province: Ontario"), ["Ontario"]);
    assert.deepEqual(extractLocationCandidates("State: California"), ["California"]);
    assert.deepEqual(extractLocationCandidates("Region: Bavaria"), ["Bavaria"]);
    assert.deepEqual(extractLocationCandidates("Shipping address: 5 Harbor Road"), ["5 Harbor Road"]);
    assert.deepEqual(extractLocationCandidates("Postal address: 10 King Street"), ["10 King Street"]);
    assert.deepEqual(extractLocationCandidates("ZIP code: 94107"), ["94107"]);
    assert.deepEqual(extractLocationCandidates("Postal code: SW1A 1AA"), ["SW1A 1AA"]);
    assert.deepEqual(extractLocationCandidates("IP location: Berlin"), ["Berlin"]);
    assert.deepEqual(extractLocationCandidates("Home address: 9 Oak Lane"), ["9 Oak Lane"]);
    assert.deepEqual(extractLocationCandidates("Work address: 2 Factory Road"), ["2 Factory Road"]);
  });

  it("reads values after the remaining Turkish location and address labels", () => {
    assert.deepEqual(extractLocationCandidates("Sokak Adresi: Atatürk Caddesi 10"), ["Atatürk Caddesi 10"]);
    assert.deepEqual(extractLocationCandidates("Şehir: İstanbul"), ["İstanbul"]);
    assert.deepEqual(extractLocationCandidates("Ülke: Türkiye"), ["Türkiye"]);
    assert.deepEqual(extractLocationCandidates("İl: Ankara"), ["Ankara"]);
    assert.deepEqual(extractLocationCandidates("İlçe: Kadıköy"), ["Kadıköy"]);
    assert.deepEqual(extractLocationCandidates("Bölge: Marmara"), ["Marmara"]);
    assert.deepEqual(extractLocationCandidates("Ofis: Paris"), ["Paris"]);
    assert.deepEqual(extractLocationCandidates("Fatura Adresi: Atatürk Caddesi 10, Ankara"), ["Atatürk Caddesi 10, Ankara"]);
    assert.deepEqual(extractLocationCandidates("Teslimat Adresi: 5 Liman Yolu"), ["5 Liman Yolu"]);
    assert.deepEqual(extractLocationCandidates("Posta Adresi: 10 Kral Sokak"), ["10 Kral Sokak"]);
    assert.deepEqual(extractLocationCandidates("Posta Kodu: 06100"), ["06100"]);
    assert.deepEqual(extractLocationCandidates("Ev Adresi: 9 Meşe Sokak"), ["9 Meşe Sokak"]);
    assert.deepEqual(extractLocationCandidates("İş Adresi: 2 Fabrika Yolu"), ["2 Fabrika Yolu"]);
  });

  it("stops before phone, name, customer, and the next location label", () => {
    assert.deepEqual(extractLocationCandidates("Location: Berlin Phone: +44 20 7946 0958"), ["Berlin"]);
    assert.deepEqual(extractLocationCandidates("City: London Name: Daniel Foster"), ["London"]);
    assert.deepEqual(extractLocationCandidates("Office: Paris Customer: Maria Garcia"), ["Paris"]);
    assert.deepEqual(extractLocationCandidates("Location: Berlin City: London"), ["Berlin", "London"]);
  });

  it("rejects a label whose whole value is a heading word", () => {
    assert.deepEqual(extractLocationCandidates("Location: Settings"), []);
    assert.deepEqual(extractLocationCandidates("Address: Book"), []);
  });
});
