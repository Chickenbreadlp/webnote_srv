import { WebSocketServer } from 'ws';
import {
    createDBDocument,
    deleteDBDocument,
    getAllDocuments,
    getChangeHistory,
    getLatestChange,
    updateDBDocument
} from './db.js';

const port = 3009;

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
            lastTimestamp: (await getLatestChange())?.timestamp || null
        }));
    }
    async function handeOfflineSync(client, data) {
        let changesSynced = false;
        const changeHistory = await getChangeHistory(data.lastTimestamp);
        console.log(data.changes);

        let commitChanges = true;
        let committingChanges = [];

        try {
            if (changeHistory.length > 0) {
                const serverChanges = {};

                for (const change of changeHistory) {
                    switch (change.type) {
                        case 'delete':
                            serverChanges[change.change.document] = { state: 'deleted' };
                            break;
                        case 'create': {
                            if (!serverChanges[change.change.document]) {
                                serverChanges[change.change.document] = { state: 'created' };
                            }
                            break;
                        }
                        case 'update': {
                            let historyEntry = serverChanges[change.change.document];
                            let entryChanged = false;
                            if (!serverChanges[change.change.document]) {
                                historyEntry = {
                                    state: 'updated',
                                    type: typeof change.change.content === 'string' ? 'text' : 'checklist',
                                    timestamp: change.timestamp
                                };

                                if (historyEntry.type === 'checklist') {
                                    historyEntry.entries = {};
                                }

                                entryChanged = true;
                            }
                            if (historyEntry.state === 'updated') {
                                if ('entryRemove' in change.change) {
                                    historyEntry.timestamp = change.timestamp;
                                    historyEntry.entries[change.change.entryRemove + ''] = {
                                        state: 'removed'
                                    }
                                    entryChanged = true;
                                }
                                if ('entryAdd' in change.change) {
                                    const addedId = change.change.entryAdd.id;
                                    historyEntry.newMaxId = addedId;
                                    historyEntry.timestamp = change.timestamp;
                                    if (!historyEntry.entries[addedId + '']) {
                                        historyEntry.entries[addedId + ''] = {
                                            state: 'created'
                                        }
                                        entryChanged = true;
                                    }
                                }
                                if ('entryChange' in change.change) {
                                    const changedId = change.change.entryChange.id;
                                    if (!historyEntry.entries[changedId + '']) {
                                        historyEntry.entries[changedId + ''] = {
                                            state: 'updated'
                                        }
                                    }
                                    if (historyEntry.entries[changedId + ''].state === 'updated') {
                                        if ('newCrossedState' in change.change.entryChange) {
                                            historyEntry.timestamp = change.timestamp;
                                            historyEntry.entries[changedId + ''].timestamp = change.timestamp
                                            historyEntry.entries[changedId + ''].crossed = {
                                                timestamp: change.timestamp,
                                                state: change.change.entryChange.newCrossedState
                                            }
                                            entryChanged = true;
                                        }
                                        if ('newText' in change.change.entryChange) {
                                            historyEntry.timestamp = change.timestamp;
                                            historyEntry.entries[changedId + ''].timestamp = change.timestamp
                                            historyEntry.entries[changedId + ''].text = {
                                                timestamp: change.timestamp,
                                                state: change.change.entryChange.newText
                                            }
                                            entryChanged = true;
                                        }
                                    }
                                }
                            }

                            if (entryChanged) {
                                serverChanges[change.change.document] = historyEntry;
                            }
                        }
                    }
                }
                console.log(serverChanges);

                for (let i = 0; i < data.changes.length; i++) {
                    const change = data.changes[i];
                    const serverChange = serverChanges[change.document] || { state: 'unchanged' };
                    let allowChange = false;

                    if (serverChange.state === 'unchanged') {
                        allowChange = true;
                    } else if (serverChange.state === 'updated') {
                        if (serverChange.type === 'text' && serverChange.timestamp < change.timestamp) {
                            allowChange = true;
                        } else if (serverChange.type === 'checklist') {
                            if ('entryChange' in change) {
                                const serverEntry = serverChange.entries[change.entryChange.id + ''];
                                if (!serverEntry) {
                                    allowChange = true;
                                } else if (serverEntry.state === 'updated') {
                                    if (
                                        'newCrossedState' in change.entryChange &&
                                        (
                                            !serverEntry.crossed ||
                                            serverEntry.crossed.timestamp < change.timestamp
                                        )
                                    ) {
                                        allowChange = true;
                                    }
                                    if (
                                        'newText' in change.entryChange &&
                                        (
                                            !serverEntry.text ||
                                            serverEntry.text.timestamp < change.timestamp
                                        )
                                    ) {
                                        allowChange = true;
                                    }
                                }
                            }
                            if ('entryAdd' in change) {
                                const newId = ++serverChange.newMaxId;
                                const oldId = change.entryAdd.id;

                                data.changes[i].entryAdd.id = newId;

                                for (let j = i + 1; j < data.changes.length; j++) {
                                    const tChange = data.changes[j];
                                    if (
                                        tChange.document === change.document &&
                                        tChange.type === 'update'
                                    ) {
                                        if ('entryChange' in tChange && tChange.entryChange.id === oldId) {
                                            data.changes[j].entryChange.id = newId;
                                        } else if ('entryRemove' in tChange && tChange.entryRemove === oldId) {
                                            data.changes[j].entryRemove = newId;
                                            break;
                                        }
                                    }
                                }

                                allowChange = true;
                            }
                            if ('entryRemove' in change) {
                                const serverEntry = serverChange.entries[change.entryRemove + ''];
                                if (
                                    !serverEntry ||
                                    (
                                        serverEntry.state === 'updated' &&
                                        serverEntry.timestamp < change.timestamp
                                    )
                                ) {
                                    allowChange = true;
                                }
                            }
                        }
                    }

                    if (allowChange) {
                        committingChanges.push(change);
                    }
                }

                console.log(committingChanges);
            } else {
                committingChanges = data.changes;
            }
        }
        catch(e) {
            commitChanges = false;
        }

        if (commitChanges) {
            for (const change of committingChanges) {
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
            }
            changesSynced = true;
        }

        if (changesSynced) {
            //await handleFetchListMsg(client);
            // Broadcast changes to other clients
            broadcast({
                msgType: 'fetchList',
                list: await getAllDocuments(),
                lastTimestamp: (await getLatestChange()).timestamp
            });

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
