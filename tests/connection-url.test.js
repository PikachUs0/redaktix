/**
 * Database/connection URL detector: ALWAYS_ON, credentials required, auto-apply.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALWAYS_ON_DETECTORS,
  isAlwaysOnDetector,
  limitToToolDetectors,
} from "../src/js/detection-profiles.js";
import {
  detectionsForAutomaticRedaction,
  extractApiTokenCandidates,
  extractConnectionUrlCandidates,
} from "../src/js/sensitive-detectors.js";
import { detectStructuredDataFromLines } from "../src/js/structured-lines.js";

function lineFromText(id, y, text, lineIndex) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let x = 8;
  const words = tokens.map((token, index) => {
    const width = Math.max(20, token.length * 7);
    const item = {
      text: token,
      confidence: 94,
      bbox: {
        x0: x, y0: y, x1: x + width, y1: y + 14, x, y, width, height: 14, w: width, h: 14,
      },
      lineId: id,
      lineIndex,
      wordIndex: index,
    };
    x += width + 4;
    return item;
  });
  return {
    id,
    text,
    confidence: 92,
    bbox: { x0: 8, y0: y, x1: x, y1: y + 14, x: 8, y, width: x - 8, height: 14, w: x - 8, h: 14 },
    words,
    lineIndex,
  };
}

describe("connection URL detector", () => {
  it("is ALWAYS_ON and survives limitToToolDetectors", () => {
    assert.equal(isAlwaysOnDetector("connection_url"), true);
    assert.ok(ALWAYS_ON_DETECTORS.includes("connection_url"));
    const kept = limitToToolDetectors(
      [{ type: "connection_url", text: "mysql://u:p@host/db" }],
      ["email"]
    );
    assert.equal(kept.length, 1);
  });

  it("auto-applies credentialed mysql/mongodb/redis/amqp/mssql/postgresql URLs", () => {
    const urls = [
      "mysql://app:s3cret@db.internal:3306/orders",
      "mongodb://app:s3cret@mongo.internal:27017/app",
      "mongodb+srv://app:s3cret@cluster.example.mongodb.net/app",
      "redis://default:s3cret@redis.internal:6379/0",
      "amqp://user:pass@rabbit.internal:5672/vhost",
      "mssql://sa:Passw0rd@sql.internal:1433/master",
      "postgresql://app_user:s3cret@db.internal:5432/redaktix",
    ];
    for (const url of urls) {
      const found = extractConnectionUrlCandidates(url);
      assert.ok(found.includes(url) || found.some((item) => item.startsWith(url.split("@")[0])), `missed ${url}: ${JSON.stringify(found)}`);
      assert.ok(
        extractApiTokenCandidates(url).some((item) => /:\/\//.test(item)),
        `postgresql path reuse should still surface connection URLs via extractApiTokenCandidates for ${url}`
      );
    }

    const lines = urls.map((url, index) => lineFromText(`u${index}`, 10 + index * 18, `DSN ${url}`, index));
    const detections = detectStructuredDataFromLines(lines, {
      profileId: "global",
      imageSize: { width: 900, height: 200 },
      linesById: new Map(lines.map((line) => [line.id, line])),
    });
    const conns = detections.filter((item) => item.type === "connection_url");
    assert.ok(conns.length >= urls.length);
    assert.equal(detectionsForAutomaticRedaction(conns).length, conns.length);
  });

  it("does not auto-apply URLs without credentials", () => {
    const bare = [
      "mysql://db.internal:3306/orders",
      "mongodb://mongo.internal/app",
      "redis://redis.internal:6379/0",
      "postgresql://db.internal:5432/redaktix",
      "https://example.com/path",
    ];
    for (const url of bare) {
      assert.deepEqual(extractConnectionUrlCandidates(url), [], url);
    }
    const line = lineFromText("b0", 12, `Host mysql://db.internal:3306/orders ready`, 0);
    const detections = detectStructuredDataFromLines([line], {
      profileId: "global-turkey",
      imageSize: { width: 700, height: 40 },
      linesById: new Map([[line.id, line]]),
    });
    assert.equal(detections.filter((item) => item.type === "connection_url").length, 0);
  });

  it("joins OCR-split host and :port into one credentialed Redis URL", () => {
    const lineText = "REDIS_URL=redis://default:p4ssw0rd@cache.example.com :6379";
    const found = extractConnectionUrlCandidates(lineText);
    assert.ok(
      found.some((item) => item.replace(/\s+/g, "").endsWith(":6379")),
      `expected port in match, got ${JSON.stringify(found)}`
    );
  });

  it("does not treat Bearer prose or credential-less schemes as connection URLs", () => {
    assert.deepEqual(extractConnectionUrlCandidates("Bearer of bad news"), []);
    assert.deepEqual(extractConnectionUrlCandidates("redis://cache.example.com:6379"), []);
    assert.deepEqual(extractConnectionUrlCandidates("postgresql://db.internal/app"), []);
  });
});
