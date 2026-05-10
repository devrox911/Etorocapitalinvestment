const http = require('http');
const payload = {
  to: 'test@example.com',
  subject: 'Logo embed test - inline',
  html: '<div style="padding:20px;"><h3>Logo embed test</h3><img src="https://raw.githubusercontent.com/yourusername/yourrepo/main/public/images/ciphervaultlogobig.svg" alt="logo" style="max-width:240px;"/></div>'
};
const data = JSON.stringify(payload);
const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/send-email',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log('response', res.statusCode, body));
});
req.on('error', e => console.error('request error', e));
req.write(data);
req.end();
