import fs from 'fs';
import SQLite from 'better-sqlite3';

const isNewDB = !fs.existsSync('data.db');
const db = new SQLite('data.db');
const dbVersion = 1.0;

export function setupDB() {
    if (isNewDB) {
        db.pragma('journal_mode = WAL');

        /* Generate custom metadata Table */
        db.prepare(`CREATE TABLE metadata(
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                meta_key    TEXT    DEFAULT '' NOT NULL,
                value       INTEGER DEFAULT 0  NOT NULL
            )`).run();
        const metaInsert = db.prepare('INSERT INTO metadata(meta_key, value) VALUES (?, ?)');
        metaInsert.run('DB_Version', dbVersion);

        /* Generate document Table */
        db.prepare(`CREATE TABLE documents(
                id                TEXT    PRIMARY KEY NOT NULL,
                locked            INTEGER DEFAULT 0   NOT NULL,
                title             TEXT                NOT NULL,
                content           TEXT                NOT NULL
            )`).run();

        /* Generate change history Table */
        db.prepare(`CREATE TABLE change_history(
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp         TEXT                NOT NULL,
                type              TEXT                NOT NULL,
                change            TEXT                NOT NULL
            )`).run();
    }
    else {
        let currentDB = 0;
        try {
            currentDB = db.prepare(`SELECT value FROM metadata WHERE meta_key = ?`).pluck(true).get('DB_Version');
        }
        catch (e) {}

        console.log(`Loaded DB v${currentDB}`);

        // Routines for DB updates go here
        /*
        if (currentDB !== dbVersion) {
            console.log(`Service expects DB v${dbVersion}. Upgrading...`);

            // ...

            db.prepare('UPDATE metadata SET value = ? WHERE meta_key = ?').run(dbVersion, 'DB_Version');
        }
        */
    }
}
