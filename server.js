const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Almacenar conexiones del mago
const magoConnections = new Set();
// Última búsqueda capturada
let ultimaBusqueda = null;

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API para recibir búsquedas del espectador
app.post('/api/busqueda', (req, res) => {
    const { termino, timestamp } = req.body;

    console.log(`[BÚSQUEDA CAPTURADA] ${termino}`);

    ultimaBusqueda = {
        termino,
        timestamp: timestamp || Date.now()
    };

    // Enviar a todos los magos conectados
    magoConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                tipo: 'busqueda',
                termino,
                timestamp: ultimaBusqueda.timestamp
            }));
        }
    });

    res.json({ ok: true });
});

// API para obtener la última búsqueda (para la pantalla de revelación)
app.get('/api/ultima-busqueda', (req, res) => {
    res.json(ultimaBusqueda || { termino: null });
});

// WebSocket para el mago
wss.on('connection', (ws, req) => {
    console.log('[MAGO CONECTADO]');
    magoConnections.add(ws);

    // Enviar última búsqueda si existe
    if (ultimaBusqueda) {
        ws.send(JSON.stringify({
            tipo: 'busqueda',
            termino: ultimaBusqueda.termino,
            timestamp: ultimaBusqueda.timestamp
        }));
    }

    ws.on('close', () => {
        console.log('[MAGO DESCONECTADO]');
        magoConnections.delete(ws);
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.tipo === 'reset') {
                ultimaBusqueda = null;
                console.log('[RESET] Búsqueda borrada');
            }
        } catch (e) {}
    });
});

// Rutas principales
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/mago', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mago.html'));
});

app.get('/revelacion', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'revelacion.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           WIKIPEDIA MAGIA - PROXY DE MENTALISMO            ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Servidor corriendo en: http://localhost:${PORT}              ║
║                                                            ║
║  URLS:                                                     ║
║  • Espectador: http://localhost:${PORT}/                      ║
║  • Panel Mago: http://localhost:${PORT}/mago                  ║
║  • Revelación: http://localhost:${PORT}/revelacion            ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});
