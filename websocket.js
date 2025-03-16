import { WebSocketServer } from 'ws';
import {
    createDBDocument,
    deleteDBDocument,
    getAllDocuments,
    getChangeHistory,
    getLatestChange,
    updateDBDocument
} from './db.js';

const port = 3001;

export function launchWebsocket() {
    const wss = new WebSocketServer({ port });
    function wssHeartbeat() {
        this.isAlive = true;
    }

    function broadcast(data, skipClients = []) {
        const sendingData = { ...data };
        if ('callbackId' in sendingData) {
            delete sendingData.callbackId;
        }

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && !skipClients.includes(client)) {
                console.log('broadcasting %s', sendingData);
                client.send(JSON.stringify(sendingData));
            }
        })
    }

    async function handleChangeMsg(client, data) {
        switch (data.change.type) {
            case 'create':
                await createDBDocument(data.change);
                break;
            case 'update':
                await updateDBDocument(data.change);
                break;
            case 'delete':
                await deleteDBDocument(data.change);
                break;
        }

        client.send(JSON.stringify(data));
        broadcast(data, [client]);
    }
    async function handleFetchListMsg(client, callbackId = undefined) {
        client.send(JSON.stringify({
            msgType: 'fetchList',
            callbackId,
            list: await getAllDocuments(),
            lastTimestamp: (await getLatestChange()).timestamp
        }));
    }
    async function handeOfflineSync(client, data) {
        let changesSynced = false;
        const changeHistory = await getChangeHistory(data.lastTimestamp);
        console.log(data.changes, data.lastTimestamp, changeHistory);

        if (changeHistory.length > 0) {
            // TODO: implement conflict handling
        }
        else {
            for (const change of data.changes) {
                switch (change.type) {
                    case 'create':
                        await createDBDocument(change);
                        break;
                    case 'update':
                        await updateDBDocument(change);
                        break;
                    case 'delete':
                        await deleteDBDocument(change);
                        break;
                }

                broadcast({ msgType: 'change', change }, [client]);
            }
            changesSynced = true;
        }

        if (changesSynced) {
            await handleFetchListMsg(client);
            client.send(JSON.stringify({
                msgType: 'offlineChangeSync',
                callbackId: data.callbackId,
                success: true
            }));
        }
        else {
            client.send(JSON.stringify({
                msgType: 'offlineChangeSync',
                callbackId: data.callbackId,
                success: false
            }));
        }
    }

    wss.on('connection', function connection(ws) {
        console.log('New client connected');
        ws.isAlive = true;
        ws.on('error', console.error);
        ws.on('pong', wssHeartbeat);

        ws.on('message', async function message(data) {
            const parsedData = JSON.parse(data);
            console.log('received: %s', parsedData);

            switch (parsedData.msgType) {
                case 'change': {
                    await handleChangeMsg(ws, parsedData);
                    break;
                }
                case 'fetchList': {
                    await handleFetchListMsg(ws, parsedData.callbackId);
                    break;
                }
                case 'offlineChangeSync': {
                    await handeOfflineSync(ws, parsedData);
                    break;
                }
            }
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
