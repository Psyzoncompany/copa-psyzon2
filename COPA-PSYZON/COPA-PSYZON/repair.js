const fs = require('fs');
let txt = fs.readFileSync('script.js', 'utf8');

// The file was likely corrupted by a replace_file_content modifying UTF-8 byte stream as if they were ISO-8859-1 strings.
// To fix it, we manually replace the known sequences.
const map = {
  'Ã¡': 'á', 'Ã©': 'é', 'Ã­': 'í', 'Ã³': 'ó', 'Ãº': 'ú',
  'Ã£': 'ã', 'Ãµ': 'õ', 'Ã§': 'ç', 'Ãª': 'ê', 'Ã¢': 'â',
  'Ã\x8D': 'Í', 'Ã“': 'Ó', 'Ãš': 'Ú', 'Ãƒ': 'Ã', 'Ã•': 'Õ',
  'Ã‡': 'Ç', 'ÃŠ': 'Ê', 'Ã‚': 'Â', 'Ã ': 'À', 'Ã‰': 'É', 'Ã ': 'Á'
};

for (const [k, v] of Object.entries(map)) {
  txt = txt.split(k).join(v);
}
// Special case because `Ã­` with the invisible char is tricky
// A common sequence is `\xC3\xAD` representing `í`. In utf8 string, node sees it as 'Ã' followed by '\xAD'.
// Let's also do a blanket replacement in buffer:
try {
  let buf = fs.readFileSync('script.js');
  let asLatin = buf.toString('latin1');
  let asUtf8 = Buffer.from(asLatin, 'latin1').toString('utf8');
  if (asUtf8.includes('Pênaltis')) {
    txt = asUtf8;
  }
} catch(e) {}

fs.writeFileSync('script.js', txt, 'utf8');
console.log("Restored");
