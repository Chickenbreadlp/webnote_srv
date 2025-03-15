import { WebSocketServer } from 'ws';

export function launchWebsocket() {
    const wss = new WebSocketServer({ port: 3002 });
    function wssHeartbeat() {
        this.isAlive = true;
    }

    wss.on('connection', function connection(ws) {
        console.log('New client connected');
        ws.isAlive = true;
        ws.on('error', console.error);
        ws.on('pong', wssHeartbeat);

        ws.on('message', function message(data) {
            console.log('received: %s', data);
        });
    });

    const interval = setInterval(function ping() {
        wss.clients.forEach(function each(ws) {
            if (ws.isAlive === false) return ws.terminate();

            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', function close() {
        clearInterval(interval);
    });
}
