const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const clients = [];
const scores = [];

function generateAcceptValue(secWebSocketKey) {
  return crypto
    .createHash('sha1')
    .update(secWebSocketKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
    .digest('base64');
}

function encodeMessage(str) {
  const data = Buffer.from(str);
  const length = data.length;
  const firstByte = 0x81; // FIN and text frame
  let header;
  if (length < 126) {
    header = Buffer.from([firstByte, length]);
  } else if (length < 65536) {
    header = Buffer.from([firstByte, 126, (length >> 8) & 0xff, length & 0xff]);
  } else {
    header = Buffer.from([
      firstByte,
      127,
      0, 0, 0, 0,
      (length >> 24) & 0xff,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
    ]);
  }
  return Buffer.concat([header, data]);
}

function decodeMessage(buffer) {
  const secondByte = buffer[1];
  let length = secondByte & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    // only handle up to 32bit length
    length = buffer.readUInt32BE(offset + 4);
    offset += 8;
  }
  const mask = buffer.slice(offset, offset + 4);
  offset += 4;
  const payload = buffer.slice(offset, offset + length);
  for (let i = 0; i < payload.length; i++) {
    payload[i] ^= mask[i % 4];
  }
  return payload.toString();
}

function broadcast(message, sender) {
  const data = encodeMessage(message);
  clients.forEach(c => {
    if (c !== sender) {
      c.write(data);
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    fs.readFile('./index.html', (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Server Error');
        return;
      }
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(data);
    });
  } else if (req.url === '/scores') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    const top = scores.sort((a, b) => b.score - a.score).slice(0, 5);
    res.end(JSON.stringify(top));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.on('upgrade', (req, socket) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request');
    return;
  }
  const acceptKey = generateAcceptValue(req.headers['sec-websocket-key']);
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
  ];
  socket.write(headers.join('\r\n') + '\r\n\r\n');
  clients.push(socket);
  socket.on('data', buffer => {
    const msg = decodeMessage(buffer);
    if (!msg) return;
    try {
      const data = JSON.parse(msg);
      if (data.type === 'score') {
        scores.push({name: data.name || 'unknown', score: data.score});
      }
      broadcast(msg, socket);
    } catch (e) {}
  });
  socket.on('close', () => {
    const idx = clients.indexOf(socket);
    if (idx !== -1) clients.splice(idx, 1);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
