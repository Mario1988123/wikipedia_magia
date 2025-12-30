const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const { URL } = require('url');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Conexiones del mago
const magoConnections = new Set();
let ultimaBusqueda = null;
let historialBusquedas = [];

// Middleware para JSON
app.use(express.json());

// Servir archivos estáticos (solo para mago y revelacion)
app.use('/mago-assets', express.static(path.join(__dirname, 'public')));

// API para el mago
app.get('/api/mago', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mago.html'));
});

app.get('/api/revelacion', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'revelacion.html'));
});

app.get('/api/manifest.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

app.get('/api/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.get('/api/ultima-busqueda', (req, res) => {
    res.json(ultimaBusqueda || { termino: null });
});

app.get('/api/historial', (req, res) => {
    res.json(historialBusquedas);
});

// WebSocket para el mago
wss.on('connection', (ws) => {
    console.log('[MAGO CONECTADO]');
    magoConnections.add(ws);

    // Enviar historial
    ws.send(JSON.stringify({
        tipo: 'historial',
        datos: historialBusquedas
    }));

    ws.on('close', () => {
        magoConnections.delete(ws);
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.tipo === 'reset') {
                ultimaBusqueda = null;
                historialBusquedas = [];
            }
        } catch (e) {}
    });
});

// Función para notificar al mago
function notificarMago(termino) {
    const datos = {
        tipo: 'busqueda',
        termino: termino,
        timestamp: Date.now()
    };

    ultimaBusqueda = datos;
    historialBusquedas.unshift(datos);
    if (historialBusquedas.length > 50) historialBusquedas.pop();

    console.log(`[BÚSQUEDA] ${termino}`);

    magoConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(datos));
        }
    });
}

// Función para hacer peticiones a Wikipedia
function fetchWikipedia(wikiPath) {
    return new Promise((resolve, reject) => {
        const url = `https://es.wikipedia.org${wikiPath}`;

        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9',
            }
        }, (response) => {
            // Seguir redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                const redirectUrl = new URL(response.headers.location, 'https://es.wikipedia.org');
                if (redirectUrl.hostname.includes('wikipedia.org')) {
                    fetchWikipedia(redirectUrl.pathname + redirectUrl.search).then(resolve).catch(reject);
                    return;
                }
            }

            let data = [];
            response.on('data', chunk => data.push(chunk));
            response.on('end', () => {
                resolve({
                    body: Buffer.concat(data),
                    headers: response.headers,
                    statusCode: response.statusCode
                });
            });
        }).on('error', reject);
    });
}

// Función para modificar el HTML de Wikipedia
function modificarHTML(html, baseUrl) {
    let modified = html;

    // Cambiar todos los enlaces internos para que apunten a nuestro servidor
    modified = modified.replace(/href="\/wiki\//g, 'href="/wiki/');
    modified = modified.replace(/href="\/w\//g, 'href="/w/');

    // Cambiar enlaces absolutos de Wikipedia
    modified = modified.replace(/href="https:\/\/es\.wikipedia\.org\/wiki\//g, 'href="/wiki/');
    modified = modified.replace(/href="https:\/\/es\.wikipedia\.org\/w\//g, 'href="/w/');
    modified = modified.replace(/href="\/\/es\.wikipedia\.org\/wiki\//g, 'href="/wiki/');
    modified = modified.replace(/href="\/\/es\.wikipedia\.org\/w\//g, 'href="/w/');

    // Cambiar action del formulario de búsqueda
    modified = modified.replace(/action="\/w\/index\.php"/g, 'action="/w/index.php"');
    modified = modified.replace(/action="https:\/\/es\.wikipedia\.org\/w\/index\.php"/g, 'action="/w/index.php"');

    // Inyectar script para capturar búsquedas
    const captureScript = `
    <script>
    (function() {
        // Interceptar el formulario de búsqueda
        document.addEventListener('submit', function(e) {
            const form = e.target;
            if (form.id === 'searchform' || form.action.includes('index.php')) {
                const searchInput = form.querySelector('input[name="search"]') ||
                                   form.querySelector('input[name="searchInput"]') ||
                                   form.querySelector('#searchInput');
                if (searchInput && searchInput.value.trim()) {
                    // Enviar al servidor
                    fetch('/api/captura', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({t: searchInput.value.trim()})
                    }).catch(()=>{});
                }
            }
        }, true);

        // También interceptar cuando hacen click en sugerencias
        document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (link) {
                const href = link.getAttribute('href');
                if (href && href.startsWith('/wiki/')) {
                    const titulo = decodeURIComponent(href.replace('/wiki/', '').replace(/_/g, ' '));
                    if (titulo && !titulo.includes(':')) {
                        fetch('/api/captura', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({t: titulo})
                        }).catch(()=>{});
                    }
                }
            }
        }, true);

        // Interceptar cambios en el input de búsqueda con sugerencias
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                if (m.target.classList && m.target.classList.contains('cdx-search-input')) {
                    const input = m.target.querySelector('input');
                    if (input && input.value) {
                        // Capturar cuando seleccionan una sugerencia
                    }
                }
            });
        });

        setTimeout(function() {
            const searchBox = document.querySelector('.cdx-search-input, #searchInput, .vector-search-box');
            if (searchBox) {
                observer.observe(searchBox, {childList: true, subtree: true});
            }
        }, 1000);
    })();
    </script>
    `;

    // Inyectar antes de </body>
    modified = modified.replace('</body>', captureScript + '</body>');

    return modified;
}

// API para capturar búsquedas
app.post('/api/captura', (req, res) => {
    const termino = req.body.t;
    if (termino) {
        notificarMago(termino);
    }
    res.json({ ok: true });
});

// Proxy para recursos estáticos de Wikipedia
app.get('/static/*', async (req, res) => {
    try {
        const result = await fetchWikipedia(req.path);

        if (result.headers['content-type']) {
            res.setHeader('Content-Type', result.headers['content-type']);
        }
        res.status(result.statusCode).send(result.body);
    } catch (error) {
        res.status(500).send('Error');
    }
});

// Proxy para /w/ (API y recursos de Wikipedia)
app.all('/w/*', async (req, res) => {
    try {
        // Capturar búsquedas desde query params
        if (req.query.search) {
            notificarMago(req.query.search);
        }

        const queryString = Object.keys(req.query).length > 0
            ? '?' + new URLSearchParams(req.query).toString()
            : '';

        const result = await fetchWikipedia(req.path + queryString);

        const contentType = result.headers['content-type'] || '';

        if (contentType.includes('text/html')) {
            let html = result.body.toString('utf-8');
            html = modificarHTML(html, req.path);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } else {
            if (result.headers['content-type']) {
                res.setHeader('Content-Type', result.headers['content-type']);
            }
            res.status(result.statusCode).send(result.body);
        }
    } catch (error) {
        console.error('Error proxy /w/:', error.message);
        res.status(500).send('Error al cargar');
    }
});

// Proxy principal para /wiki/
app.get('/wiki/*', async (req, res) => {
    try {
        // Capturar el título del artículo visitado
        const titulo = decodeURIComponent(req.path.replace('/wiki/', '').replace(/_/g, ' '));
        if (titulo && !titulo.includes(':') && !titulo.includes('Especial')) {
            // Solo capturar artículos, no páginas especiales
            // notificarMago(titulo); // Descomentar si quieres capturar navegación también
        }

        const result = await fetchWikipedia(req.path);

        const contentType = result.headers['content-type'] || '';

        if (contentType.includes('text/html')) {
            let html = result.body.toString('utf-8');
            html = modificarHTML(html, req.path);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } else {
            if (result.headers['content-type']) {
                res.setHeader('Content-Type', result.headers['content-type']);
            }
            res.status(result.statusCode).send(result.body);
        }
    } catch (error) {
        console.error('Error proxy /wiki/:', error.message);
        res.status(500).send('Error al cargar el artículo');
    }
});

// Página principal - redirigir a Wikipedia principal
app.get('/', async (req, res) => {
    try {
        const result = await fetchWikipedia('/wiki/Wikipedia:Portada');
        let html = result.body.toString('utf-8');
        html = modificarHTML(html, '/');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (error) {
        console.error('Error:', error.message);
        res.redirect('/wiki/Wikipedia:Portada');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          WIKIPEDIA MAGIA - PROXY INVERSO REAL                 ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Servidor: http://localhost:${PORT}                              ║
║                                                               ║
║  URLS:                                                        ║
║  • Wikipedia (espectador): http://localhost:${PORT}/              ║
║  • Panel Mago (PWA):       http://localhost:${PORT}/api/mago      ║
║  • Revelación:             http://localhost:${PORT}/api/revelacion║
║                                                               ║
║  Para acceder desde móvil, usa tu IP local:                   ║
║  Ejecuta 'ipconfig' para ver tu IP (ej: 192.168.1.X)          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});
