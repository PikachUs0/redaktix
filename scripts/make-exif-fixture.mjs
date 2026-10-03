import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "..", "tests", "fixtures");
mkdirSync(dir, { recursive: true });

function u16(n) {
  return Buffer.from([(n >> 8) & 255, n & 255]);
}

const soi = Buffer.from([0xff, 0xd8]);
const exifAscii = Buffer.from(
  [
    "Exif",
    "\0\0",
    "MM\0*",
    "\0\0\0\x08",
    "Make\0Canon\0",
    "Model\0TestCam\0",
    "DateTime\0:2024:01:15 12:34:56\0",
    "GPS\0GPSLatitude\0GPSLongitude\0",
  ].join(""),
  "binary"
);
const exifApp1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exifAscii.length + 2), exifAscii]);

const xmpInner =
  'http://ns.adobe.com/xap/1.0/\0<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>';
const xmpBody = Buffer.from(xmpInner, "binary");
const xmpApp1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(xmpBody.length + 2), xmpBody]);

const rest = Buffer.from([
  0xff, 0xdb, 0x00, 0x43, 0x00,
  ...Array(64).fill(16),
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9,
]);

const jpg = Buffer.concat([soi, exifApp1, xmpApp1, rest]);
const out = join(dir, "exif-sample.jpg");
writeFileSync(out, jpg);
console.log("wrote", out, "bytes", jpg.length);
console.log("Exif", jpg.includes(Buffer.from("Exif")));
console.log("xap", jpg.includes(Buffer.from("http://ns.adobe.com/xap")));
console.log("GPS", jpg.includes(Buffer.from("GPS")));
console.log("Make", jpg.includes(Buffer.from("Make")));
