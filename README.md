# Webnote Serv
Webnote is a Nuxt-based note taking app, intended to run fully inside the browser.  
This is the optional network sync service. The Webnote UI connects to it via a WebSocket to sync any changes live to other clients and an SQLite DB for safekeeping.

This service is also responsible for managing change collissions for when a client has staged changes while it was offline.  
It's logic here is "latest change wins", except when a document or entry in a checklist was deleted, in which case any changes from the client on that entry are ignored (including deletion and re-creation of that document!)

## Prerequisites
All you need is a modern version of Node.  
Python and Visual C++ Buildtools are also required for the SQLite interface on Windows (this requisite may differ on other platforms)

## Setup
Just install all dependencies:
```sh
npm run install
```

## Server
Start the server on `http://localhost:3009`:
```sh
npm run start
```

## Config
Currently there is no configuration options for the service.  
You can however manually change the port number in `websocket.js` if you absolutely need a different port for now.