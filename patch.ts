import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');
content = content.replace(/191,255,0/g, '255,0,0');
fs.writeFileSync('src/App.tsx', content);

let indexContent = fs.readFileSync('index.html', 'utf8');
indexContent = indexContent.replace(/bfff00/g, 'ff0000');
fs.writeFileSync('index.html', indexContent);
