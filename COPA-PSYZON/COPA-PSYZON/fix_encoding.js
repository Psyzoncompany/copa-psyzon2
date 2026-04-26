const fs = require('fs');
let txt = fs.readFileSync('script.js', 'utf8');
const replacements = {
  'Ã¡': 'á', 'Ã©': 'é', 'Ã­': 'í', 'Ã³': 'ó', 'Ãº': 'ú',
  'Ã£': 'ã', 'Ãµ': 'õ', 'Ã§': 'ç', 'Ãª': 'ê', 'Ã¢': 'â',
  'Ã\x8D': 'Í', 'Ã“': 'Ó', 'Ãš': 'Ú', 'Ãƒ': 'Ã', 'Ã•': 'Õ',
  'Ã‡': 'Ç', 'ÃŠ': 'Ê', 'Ã‚': 'Â', 'Ã ': 'À', 'Ã‰': 'É', 'Ã ': 'Á'
};
// Let's also do a fallback if latin1 buffer conversion is better:
let latinTxt = Buffer.from(fs.readFileSync('script.js', 'latin1')).toString('utf8');
if (latinTxt.includes('Pênaltis')) {
  fs.writeFileSync('script_fixed.js', latinTxt, 'utf8');
  console.log('Fixed via latin1 buffer');
  process.exit(0);
}

for (const [k, v] of Object.entries(replacements)) {
  txt = txt.split(k).join(v);
}
fs.writeFileSync('script_fixed.js', txt, 'utf8');
console.log('Done manual replace');
