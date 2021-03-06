// if node
var url = require('url');
var http = require('http');
var https = require('https');
var util = require('./util');
var Serializer = require('./serializer');
var TCP = require('./tcp').TCP;
var Client = require('./client');
// end node

function Connection(bridge) {
  var self = this;
  // Set associated bridge object
  this.bridge = bridge;

  this.options = bridge._options;

  // Preconnect buffer
  this.sockBuffer = new SockBuffer();
  this.sock = this.sockBuffer;

  // Connection configuration
  this.interval = 400;
}

// Contact redirector for host and port
Connection.prototype.redirector = function () {
  var self = this;
  // Use JSON to retrieve host and port
  if (this.options.tcp) {
    var redirector = url.parse(this.options.redirector);

    var http_impl;
    if(this.options.secure) {
      http_impl = https;
    } else {
      http_impl = http;
    }

    http_impl.get({
      host: redirector.hostname,
      port: redirector.port,
      path: '/redirect/' + this.options.apiKey
    }, function (res) {
      var data = "";
      res.on('data', function (chunk){
        data += chunk;
      });
      res.on('end', function (){
        try {
          var obj = JSON.parse(data);
          self.options.host = obj.data.bridge_host;
          self.options.port = obj.data.bridge_port;
          if (!self.options.host || !self.options.port) {
            util.error('Could not find host and port in JSON body');
          } else {
            self.establishConnection();
          }
        } catch (e) {
          util.error('Unable to parse redirector response ' + data);
        }
      });
    }).on('error', function (e) {
      util.error('Unable to contact redirector');
    });
  } else {
    // Use JSONP to retrieve host and port
    window.bridgeHost = function (status, host, port){
      self.options.host = host;
      self.options.port = parseInt(port, 10);
      if (!self.options.host || !self.options.port) {
        util.error('Could not find host and port in JSON');
      } else {
        self.establishConnection();
      }
    };
    var s = document.createElement('script');
    s.setAttribute('src', this.options.redirector + '/redirect/' + this.options.apiKey + '/jsonp');
    document.getElementsByTagName('head')[0].appendChild(s);
  }
}

Connection.prototype.reconnect = function () {
  util.info('Attempting reconnect');
  var self = this;
  if (this.interval < 32768) {
    setTimeout(function (){
      self.establishConnection();
      // Grow timeout for next reconnect attempt
      self.interval *= 2;
    }, this.interval);
  }
};

Connection.prototype.establishConnection = function () {
  var self = this;

  var sock;
  // Select between TCP and SockJS transports
  if (this.options.tcp) {
    util.info('Starting TCP connection', this.options.host, this.options.port);
    sock = new TCP(this.options).sock;
  } else {
    util.info('Starting SockJS connection', this.options.host, this.options.port);
    var protocol;

    if(this.options.secure) {
      protocol = "https://";
    } else {
      protocol = "http://";
    }

    sock = new SockJS(protocol + this.options.host + ':' + this.options.port + '/bridge', this.options.protocols, this.options.sockjs);
  }

  sock.bridge = this.bridge;
  // Set onmessage handler to handle connect response
  sock.onmessage = function (message) {
    // Parse for client id and secret
    var ids = message.data.toString().split('|');
    if (ids.length !== 2) {
      // Handle message normally if not a correct CONNECT response
      self.processMessage(message);
    } else {
      util.info('clientId received', ids[0]);
      self.clientId = ids[0];
      self.secret = ids[1];
      self.interval = 400;
      // Send preconnect queued messages
      if (self.sock.processQueue)
        self.sock.processQueue(sock, self.clientId);
      // Set connection socket to connected socket
      self.sock = sock;
      // Set onmessage handler to handle standard messages
      self.sock.onmessage = self.processMessage;
      util.info('Handshake complete');
      //   Trigger ready callback
      if (!self.bridge._ready) {
        self.bridge._ready = true;
        self.bridge.emit('ready');
      }
    }
  };

  sock.onopen = function () {
    util.info('Beginning handshake');
    var msg = util.stringify({command: 'CONNECT', data: {session: [self.clientId || null, self.secret || null], api_key: self.options.apiKey} });
    sock.send(msg);
  };

  sock.onclose = function () {
    util.warn('Connection closed');
    // Restore preconnect buffer as socket connection
    self.sock = self.sockBuffer;
    if (self.options.reconnect) {
      self.reconnect();
    }
  };
};

Connection.prototype.processMessage = function (message) {
  try {
    util.info('Received', message.data);
    message = util.parse(message.data);
  } catch (e) {
    util.error('Message parsing failed');
    return;
  }
  // Convert serialized ref objects to callable references
  Serializer.unserialize(this.bridge, message.args);
  // Extract RPC destination address
  var destination = message.destination;
  if (!destination) {
    util.warn('No destination in message', message);
    return;
  }
  if (typeof message.source === 'string') {
    // Return a Client object.
    this.bridge._context = new Client(this.bridge, message.source);
  }
  this.bridge._execute(message.destination.ref, message.args);
};

Connection.prototype.sendCommand = function (command, data) {
  var msg = util.stringify({command: command, data: data });
  util.info('Sending', msg);
  this.sock.send(msg);
};

Connection.prototype.start = function () {
  if (!this.options.host || !this.options.port) {
    this.redirector();
  } else {
    // Host and port are specified
    this.establishConnection();
  }
};

function SockBuffer () {
  // Buffer for preconnect messages
  this.buffer = [];
}

SockBuffer.prototype.send = function(msg) {
  this.buffer.push(msg);
};

SockBuffer.prototype.processQueue = function(sock, clientId) {
  for(var i = 0, ii = this.buffer.length; i < ii; i++) {
    // Replace null client ids with actual client_id after handshake
    sock.send(this.buffer[i].replace(/"client",null/g, '"client","'+clientId+'"'));
  }
  this.buffer = [];
};

// if node
exports.Connection = Connection;
// end node
