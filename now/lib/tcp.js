var net = require('net');
var iostream = require('iostream');

function createTCPConn(options) {
  sock = net.connect(options.port, options.host, function() {
    setTimeout(sock.conn_init, 0);
  });

  sock.conn_init = function() {
    sock._iostream = new iostream.IOStream(sock);
    sock.wait_for_message(function(data) {
      sock._connid = data.toString();
      sock.handshake_complete();
    });
  }

  sock.wait_for_message = function(callback) {
    sock._iostream.read_bytes(4, function(data) {
      bytecount = data.readUInt32BE(0);
      console.log('got', bytecount);
      sock._iostream.read_bytes(bytecount, function(data) {
        callback(data);
      });
    });
  }

  sock.message_received = function(data) {
    sock.onmessage(data);
    sock.wait_for_message(sock.message_received);
  }

  sock.send = function(data) {
    outstr = Buffer( 'xxxx' + data )
    outstr.writeUInt32LE( Buffer.byteLength(data), 0 )
    sock._iostream.write( outstr )
  }

  sock.handshake_complete = function() {
    sock.wait_for_message(sock.message_received);
      
    sock.on('close', sock.onclose);
    sock.onopen();
  }
  return sock;
}

exports.createTCPConn = createTCPConn