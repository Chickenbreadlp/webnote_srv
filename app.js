import { launchWebsocket } from './websocket.js';
import { setupDB } from './db.js';

setupDB();

launchWebsocket();
