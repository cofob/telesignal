const {execSync} = require('child_process');
const {readFileSync, writeFileSync} = require('fs');

const willPaste = process.argv[2] === '1';
const sourceFile = process.argv[2];

const sourceContent = (() => {
  if(willPaste) {
    return execSync('pbpaste', {encoding: 'utf8'});
  }
  if(sourceFile) {
    return readFileSync(sourceFile, 'utf8');
  }
})();

if(sourceContent) {
  const path = `${__dirname}/src/scripts/in/schema.json`;
  const schemaIn = readFileSync(path, 'utf8');
  const replaced = schemaIn.replace(/("API": ).+?(,\n)/, `$1${sourceContent}$2`);
  writeFileSync(path, replaced);
}

// * TeleSignal: no MTProto runtime schema is left (the managers speak Telegram's shapes through the Signal adapter),
// * so only the types of the layer are generated

execSync(`npm run generate-mtproto-types`);
