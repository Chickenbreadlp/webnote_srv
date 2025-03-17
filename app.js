import { launchWebsocket } from './websocket.js';
import { setupDB, vacuumDB } from './db.js';

setupDB();

launchWebsocket();

function cleanupDB() {
    setTimeout(async () => {
        await vacuumDB();
        cleanupDB();
    }, 24 * 60 * 60 * 1000);
}
cleanupDB();
