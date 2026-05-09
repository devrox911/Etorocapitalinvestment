import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const imagePath = path.join(__dirname, 'public/images/email-logo.png');
const imageBuffer = fs.readFileSync(imagePath);
const base64String = imageBuffer.toString('base64');
const dataUri = `data:image/png;base64,${base64String}`;

console.log('✅ Logo converted to base64');
console.log('Size:', dataUri.length, 'characters');
console.log('\n📋 Data URI (for email templates):');
console.log(dataUri);
