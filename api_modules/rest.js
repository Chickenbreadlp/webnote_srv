import express from 'express';

const app = express();

export function launchREST() {
    app.listen(3001, () => {
        console.log('Listening on port 3001');
    });
}
