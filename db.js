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
                type              TEXT                NOT NULL,
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

export async function getAllDocuments() {
    const dbDocs = await db.prepare(`
            SELECT *
            FROM documents
        `).all();

    return dbDocs
        .map(doc => {
            if (doc.type === 'text') {
                return {
                    id: doc.id,
                    title: doc.title,
                    locked: doc.locked === 1,
                    text: JSON.parse(doc.content)
                };
            }
            if (doc.type === 'checklist') {
                return {
                    id: doc.id,
                    title: doc.title,
                    entries: JSON.parse(doc.content)
                };
            }
            return null;
        })
        .filter(doc => doc !== null);
}
export async function getDocument(id) {
    try {
        const dbDoc = await db.prepare(`
                SELECT *
                FROM documents
                WHERE id = ?;
            `).get(id);

        if (dbDoc.type === 'text') {
            return {
                id: dbDoc.id,
                title: dbDoc.title,
                locked: dbDoc.locked === 1,
                text: JSON.parse(dbDoc.content)
            };
        }
        if (dbDoc.type === 'checklist') {
            return {
                id: dbDoc.id,
                title: dbDoc.title,
                entries: JSON.parse(dbDoc.content)
            };
        }
    }
    catch(e) {}
    return null;
}
export async function getLatestChange() {
    let historyEntry;
    try {
        historyEntry = await db.prepare(`
                SELECT change
                FROM change_history
                WHERE id = (SELECT id FROM change_history ORDER BY timestamp DESC LIMIT 1)
            `).get();
    }
    catch(e) {}

    if (historyEntry) {
        return JSON.parse(historyEntry.change);
    }
}

async function logChange(change) {
    if (
        'type' in change &&
        'timestamp' in change
    ) {
        await db.prepare(`
                INSERT INTO change_history(timestamp, type, change)
                VALUES (?, ?, ?)
            `).run(
                change.timestamp,
                change.type,
                JSON.stringify(change)
            );
    }
}

export async function createDBDocument(change) {
    await logChange(change);
    if (
        'document' in change &&
        'title' in change &&
        'content' in change
    ) {
        const docType = typeof change.content === 'string' ? 'text' : 'checklist';
        await db.prepare(`
                INSERT INTO documents(id, title, type, content)
                VALUES (?, ?, ?, ?)
            `).run(
                change.document,
                change.title,
                docType,
                JSON.stringify(change.content)
            );
    }
}
export async function updateDBDocument(change) {
    await logChange(change);
    if ('document' in change) {
        let document;
        try {
            document = await db.prepare(`
                    SELECT type, content
                    FROM documents
                    WHERE id = ?
                `).get(
                    change.document
                );
        }
        catch(e) {}

        if (document) {
            let changeApplied = false;
            document.content = JSON.parse(document.content);
            if (document.type === 'text' && 'textChange' in change) {
                document.content = change.textChange;
                changeApplied = true;
            }
            else if (document.type === 'checklist') {
                if ('entryChange' in change) {
                    const entryChange = change.entryChange;
                    const entryIndex = document.content.findIndex(entry => entry.id === entryChange.id);

                    if (entryIndex !== -1) {
                        const entry = document.content[entryIndex];

                        if (entryChange.newText)
                            entry.text = entryChange.newText;
                        if (typeof entryChange.newCrossedState === 'boolean')
                            entry.crossed = entryChange.newCrossedState;

                        changeApplied = true;
                    }
                }
                if ('entryAdd' in change) {
                    if (change.entryAdd.atTop) {
                        document.content.unshift({
                            id: change.entryAdd.id,
                            text: change.entryAdd.text,
                            crossed: change.entryAdd.crossedState
                        });
                        changeApplied = true;
                    }
                    else {
                        document.content.push({
                            id: change.entryAdd.id,
                            text: change.entryAdd.text,
                            crossed: change.entryAdd.crossedState
                        });
                        changeApplied = true;
                    }
                }
                if ('entryRemove' in change) {
                    const index = document.content.findIndex(entry => entry.id === change.entryRemove);
                    if (index !== -1) {
                        document.content.splice(index, 1);
                        changeApplied = true;
                    }
                }
                if ('entryReorder' in change) {
                    const newEntryOrder = [];
                    for (const entryId of change.entryReorder) {
                        const entry = document.content.find(entry => entry.id === entryId);
                        if (entry) {
                            newEntryOrder.push(entry);
                        }
                    }
                    document.content = newEntryOrder;
                    changeApplied = true;
                }
            }

            if (changeApplied) {
                await db.prepare(`
                        UPDATE documents
                        SET content = ?
                        WHERE id = ?
                    `).run(
                        JSON.stringify(document.content),
                        change.document
                    );
            }
        }
    }
}
export async function deleteDBDocument(change) {
    await logChange(change);
    if ('document' in change) {
        await db.prepare(`
                DELETE FROM documents
                WHERE id = ?
            `).run(
                change.document
            );
    }
}

export async function getChangeHistory(fromTimestamp) {
    return db.prepare(`
            SELECT timestamp, type, change
            FROM change_history
            WHERE timestamp > ?
            ORDER BY timestamp
        `)
        .all(fromTimestamp)
        .map(row => ({ ...row, change: JSON.parse(row.change) }));
}

export async function vacuumDB() {
    await db.prepare(`VACUUM`).run();
}
